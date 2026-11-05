# Architecture

The system has an offline indexing pipeline and an online query path. They share one chunker, so the chunks in Pinecone and the chunks in the in-memory keyword index always have the same ids and text.

```
OFFLINE  (rag-ingest, rag-index; re-run when the docs change)

  godot-docs (git) ─► parse_rst ─► documents.jsonl ─► chunk ─► embed ─► Pinecone
                                          │                              ▲
                                          │                    manifest: path → hash, chunk count
ONLINE   (FastAPI)                        ▼
                                   BM25 index (in memory, built at startup)
                                          │
  question ─┬─► embed ─► Pinecone top-20 ─┤
            └─► BM25 top-20 ──────────────┴─► RRF ─► top-k ─► prompt ─► LLM ─► answer + cited sources
```

| Stage | Module | Model involved |
|---|---|---|
| Fetch | `ingest/fetch.py` | none |
| Parse RST → sections | `ingest/parse_rst.py` | none |
| Chunk | `chunking.py` | none (tiktoken for counting) |
| Embed | `embeddings.py` | `text-embedding-3-small` |
| Store / sync | `store.py`, `indexing.py` | none |
| Vector, keyword, hybrid search | `retrieval.py`, `keyword.py` | embedding model for the query |
| Prompt + answer | `generation.py` | chat model (`gpt-4o-mini` by default) |
| HTTP | `api.py` | none |

## Ingestion and parsing

`rag-ingest` shallow-clones `godotengine/godot-docs` (or fetches the latest commit of the configured branch) and converts every `.rst` page into a `Document`: title, public URL, a list of sections with their heading paths, and a SHA-256 of the cleaned text.

The parser is plain code rather than an LLM. It's deterministic, which matters because the content hash drives sync, and it can't silently drop or rewrite content. It handles the subset of RST and Sphinx that the Godot docs use:

- Headings (with and without overlines), with levels inferred from first use of each adornment style
- Admonitions kept as `Note: ...` / `Warning: ...`; code blocks kept as fenced blocks with language; tab containers unwrapped
- Images, toctrees, labels, comments and raw HTML dropped
- Roles and links reduced to their readable text (``:ref:`Nodes <doc_nodes>` `` → `Nodes`)
- Class-reference noise (backslash escapes, permalink icons, `:github_url:` fields) removed

The hash is computed on the cleaned text, so edits a reader can't see (comments, image paths) don't trigger a re-embed. Writes go to a temp file that is swapped in at the end, so a failed run never leaves a partial `documents.jsonl`.

Output on the `stable` branch: 1,565 pages, ~8,300 sections.

## Chunking

`chunk_document()` turns each document's sections into chunks of at most 500 tokens:

1. **Headings first.** Sections are the author's topic boundaries, so they are the first split.
2. **Merge tiny sections** (under 100 tokens) into the next one, or the previous one at the end of a page, as long as the result still fits. Merged chunks keep the shared heading path and include the sub-heading as a line of text.
3. **Split long sections** at paragraph and fenced-code boundaries. A single block is cut by token windows only when it alone exceeds the budget (the largest class-reference sections are ~70k tokens).
4. **Overlap** consecutive pieces of a split section by ~50 tokens, starting at a word boundary.
5. **Prefix** every chunk with `Title > Heading > Subheading`. The prefix is part of `Chunk.text`, so the embedded string and the string the LLM reads are identical.

All limits are measured with the `cl100k_base` tokenizer on the final string. BPE counts aren't additive across joins, so the overlap step re-measures and shrinks until the chunk fits.

Result: 8,580 chunks, 2.64M tokens (about $0.05 to embed), mean 307 and max 500 tokens.

## Storage and sync

Pinecone serverless index, cosine metric, 1536 dimensions. One record per chunk:

- `id`: `<page path>#<chunk index>`, e.g. `tutorials/scripting/signals.rst#3`
- `values`: the embedding
- `metadata`: path, URL, title, heading path, chunk index, chunk hash and the chunk text, so a query returns everything the prompt and citations need in one call

Pinecone has no documents table, so `data/index_manifest.json` stores `{path: {content_hash, chunk_count}}`. `rag-index` uses it to:

| Page state | Action |
|---|---|
| Hash unchanged | Skip, nothing is embedded |
| New or changed | Chunk, embed, upsert; delete `path#n..path#old` if it now has fewer chunks |
| Gone from the docs | Delete all its chunk ids |

Pinecone is written before the manifest, and the manifest is saved atomically after each batch. If a run dies, unfinished pages still carry their old hash and are redone on the next run; deterministic ids make that an overwrite, so runs are idempotent. Because ids are derived from the manifest's chunk counts, deletes never need to list the index.

The same command is the sync job: running it on a schedule after `rag-ingest` re-embeds only the pages that changed upstream.

## Retrieval

- **Vector**: embed the question, `index.query(top_k=k, include_metadata=True)`. The Pinecone connection is created once per process and reused.
- **Keyword**: BM25 (k1 = 1.5, b = 0.75) over an inverted index built from `documents.jsonl` at API startup (a few seconds; queries take milliseconds). snake_case identifiers are indexed whole and split, so `move_and_slide` matches both the identifier and "move and slide".
- **Hybrid** (default): top 20 from each, merged with Reciprocal Rank Fusion (`Σ 1/(60 + rank)`), cut to k. RRF uses ranks only, so cosine and BM25 scores never have to be put on one scale, and chunks both searches agree on rise to the top.

## Generation

- The system prompt restricts the model to the excerpts, requires `[n]` citations after the sentences they support, and tells it to say when the docs don't cover the question.
- Excerpts are numbered, carry their source URL, and sit inside a `<context>` block. Any `<context>` tags inside retrieved text are stripped, so a page can't close the block and smuggle in instructions. The model has no tools, so injected text can at worst affect the wording of one answer.
- If retrieval returns nothing, the LLM isn't called and the API returns a fixed "not found" answer, so it can't fall back on the model's memory.
- Only the excerpts the answer actually cites are returned as sources. Citation numbers outside the retrieved range are dropped.

## API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness |
| `GET /search?q=&k=&mode=` | Retrieval only, with scores. The first place to look when an answer is wrong. |
| `POST /ask` `{question, k?, mode?}` | Retrieve, then answer with cited sources |

Requests are validated (`mode` ∈ hybrid / vector / keyword, `1 ≤ k ≤ 20`, question 1–1000 characters). Missing API keys return 503 with the variable to set; OpenAI or Pinecone failures return 502 and are logged. Every `/ask` logs the mode, latency, retrieved chunk ids and cited numbers, which is what makes "was this a retrieval or a generation failure?" answerable after the fact.
