# Architecture

## Two phases

**Offline / indexing**: runs ahead of time, and again whenever the docs change.

1. **Fetch**: pull the godot-docs git repo (`rag/ingest/fetch.py`)
2. **Parse**: convert each `.rst` page to clean text split by headings, with metadata (`rag/ingest/parse_rst.py`)
3. **Chunk**: split sections into pieces small enough to embed and put in a prompt (`rag/chunking.py`)
4. **Embed**: run each chunk through the embedding model (`rag/embeddings.py`)
5. **Store**: write vector + text + metadata to Pinecone (`rag/store.py`)

**Online / per question**

6. **Embed the question** with the same embedding model
7. **Search**: find the closest chunks (vector, keyword, or both) (`rag/retrieval.py`)
8. **Build the prompt** from those chunks' text plus the question (`rag/generation.py`)
9. **Generate**: the LLM writes the answer and cites sources
10. Return answer + source links to the UI

## Which parts are AI and which are plain code

| Step | What does it |
|---|---|
| Fetch, parse, chunk | Plain code |
| Text → vectors | **Embedding model** (small, separate model; no answering) |
| Comparing vectors | Plain math (cosine similarity), done by Pinecone |
| Building the prompt | Plain code |
| Writing the answer | **LLM** (chat model) |

RAG's job is to **build a good prompt**. The LLM receives that prompt and doesn't know a search happened.

```python
# 1. Retrieval: our code + embedding model + vector DB
question_vector = embed_query(user_question)
chunks = search(question_vector, top_k=5)

# 2. Augmentation: our code builds the prompt
context = "\n---\n".join(c.text for c in chunks)
prompt = f"""Answer using only this context:
{context}

Question: {user_question}"""

# 3. Generation: the LLM
answer = llm.complete(prompt)
```

## Data model

Pinecone stores **one record per chunk** (serverless index, cosine metric, 1536 dimensions for `text-embedding-3-small`):

- `id`: `<page path>#<chunk index>`, e.g. `tutorials/scripting/signals.rst#3`. It's deterministic, so re-indexing a page overwrites its records instead of duplicating them.
- `values`: the embedding
- `metadata`: path, URL, title, heading path, chunk index, `content_hash`, and the chunk **text** itself, so search results go straight into the prompt with no second lookup

Pinecone has no documents table, so `data/index_manifest.json` records what's in the index: `{path: {content_hash, chunk_count}}`. Sync uses it to skip pages whose `content_hash` hasn't changed (only changed pages get re-embedded), to delete leftover chunks when a page shrinks, and to delete every chunk of a page that no longer exists.

## Parsing

`.rst` → clean text with **plain code, not an LLM**. Every source format already has structure we can convert deterministically. It's free, fast, and can't silently drop or invent content. An LLM would only be worth it for genuinely messy input (e.g. summarizing a long, noisy ticket thread).

What the parser does:
- Splits pages into sections by heading and records the heading path (`Using signals > Connecting a signal in code`)
- Keeps notes/warnings as `Note: ...`, keeps code as fenced blocks, unwraps tabs
- Drops images, toctrees, labels, comments, raw HTML
- Turns roles/links into readable text: ``:ref:`Nodes <doc_nodes>` `` → `Nodes`
- Cleans class-reference noise (escapes, permalink icons)

Output: `data/documents.jsonl`, one `Document` per line.

Current numbers (`stable` branch): ~1,600 pages → ~8,300 sections, ~11 MB of text (roughly 2.7M tokens; costs only cents to embed with `text-embedding-3-small`).

## Chunking (milestone 2)

Chunk quality has a big effect on answer quality. The plan:

- Split **along headings** (we already have sections), not raw character counts
- Target **~300–500 tokens** per chunk, measured with `tiktoken`
- Split long sections further with **~50 tokens of overlap** so a thought isn't cut in half. Some class-reference sections are huge (the largest is ~280k characters), so this matters.
- **Merge tiny sections** into a neighbour
- Prefix each chunk with its **title + heading path** before embedding, so the vector carries context
- Every chunk keeps its document's metadata (URL, title) for citations

## Retrieval (milestone 3)

1. **Vector search**: `index.query(vector=..., top_k=k, include_metadata=True)` (cosine similarity)
2. **Keyword search**: sparse vectors in Pinecone, e.g. a separate sparse index using its hosted `pinecone-sparse-english-v0` model. Catches exact API names like `move_and_slide` or `CharacterBody2D`, which embeddings can miss.
3. **Hybrid**: merge both lists with Reciprocal Rank Fusion
4. **Rerank** (later): fetch ~20 candidates, then a reranker model picks the best 5

Each step is kept only if the eval set shows it helps.

## Generation (milestone 4)

- System prompt: answer **only** from the context, **cite** `[1]`, `[2]`, and say so when the docs don't cover it
- Retrieved text is **untrusted data**: it's delimited from instructions (prompt-injection defence)
- Follow-up questions in a chat ("what about 3D?") get rewritten into standalone questions before searching
- Stream tokens to the UI
