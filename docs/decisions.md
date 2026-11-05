# Design decisions

Short records of the non-obvious choices, what they trade off, and when I'd revisit them.

## Dataset: the Godot docs

- Openly licensed (CC BY 3.0), so there are no access or permission concerns.
- Large enough (~1,600 pages, 2.6M tokens) that retrieval quality actually matters.
- Updated regularly, which gives incremental sync a real job to do.
- Mixes prose tutorials with a generated API reference, which exercises both semantic and exact-identifier search.
- Easy to judge answers against, which makes a labelled eval set practical.

## Parse with code, not an LLM

Every page goes through a hand-written RST converter instead of an LLM "clean this up" pass.

- **Deterministic.** The same input always gives the same text, so the content hash only changes when the docs do. Non-deterministic cleaning would trigger re-embeds on every run.
- **Faithful.** Code can't silently summarise, drop or invent content.
- **Cheap and fast.** The whole corpus parses in seconds for free.

An LLM pass would be worth it only for genuinely unstructured input, such as scanned PDFs or long chat threads.

## One provider for embeddings and answers (OpenAI)

One key and one bill. The two models are independent: the chat model only ever sees chunk text, never vectors, so either can be swapped. Using Claude for answers would be a config-sized change in `generation.py`, but would still need a separate embedding provider (OpenAI or Voyage).

## Embedding model: `text-embedding-3-small` (1536 dims)

Cheap enough to re-embed the whole corpus freely (~$0.05) and strong on English technical text. Changing models means a new index, because vectors from different models aren't comparable: build it alongside the old one, compare with `rag-eval`, then switch `PINECONE_INDEX`. `text-embedding-3-large` and Voyage are the obvious candidates to compare.

## Vector store: Pinecone serverless

- Managed, so there's nothing to run locally, and the free tier holds the ~8.6k chunks easily.
- Chunk text lives in record metadata, so one query returns everything the prompt and citations need.
- Trade-off against Postgres + pgvector: one more external service, and no relational table for documents. A small manifest file (`data/index_manifest.json`) fills that gap for sync. In a company already running Postgres, pgvector would likely be the better default.

## Chunking: headings first, 500-token cap, prefix stored in the text

- Headings are the first split because they're the author's own topic boundaries. Long sections split at paragraph and code-block boundaries, so code examples stay whole where possible; token-window cuts are a last resort.
- 500 tokens max (prefix included), 50 tokens overlap, sections under 100 tokens merged. These are reasonable starting values; chunk size is the next parameter to sweep with the eval harness.
- The `Title > Heading` prefix is stored inside `Chunk.text`, so the embedded text and the text the LLM reads can't drift apart.
- Token counts are measured on the final string, because BPE counts aren't additive across joins. A unit test caught 501-token chunks before this was fixed.

## Keyword search: hand-written BM25 in memory

Rather than Pinecone sparse vectors or a search engine:

- ~8.6k chunks fit in a few MB. The index builds in seconds at startup and a query takes milliseconds, with no second index to keep in sync.
- Works without API keys, which made it possible to evaluate keyword retrieval on the real corpus immediately.
- About 60 lines with no dependencies, and every part of the formula is visible.
- Trade-offs: each API process holds its own copy and rebuilds it at startup, and it must be built from the same `documents.jsonl` and chunker as Pinecone (it is, so ids match). At millions of chunks this moves to OpenSearch or Pinecone sparse-dense vectors.

## Hybrid search with Reciprocal Rank Fusion

**Hypothesis:** Godot questions often contain exact identifiers (`move_and_slide`, `CharacterBody2D`) that embeddings blur, and paraphrases ("my game freezes when I switch to a big level") that keyword search can't match, so combining the two should beat either alone.

RRF merges the two lists using ranks only, so cosine and BM25 scores never need a common scale, and it needs no tuning beyond the standard k = 60.

**What the eval showed:** half of the hypothesis held. Keyword search scored 100% on exact-API questions but 30% on paraphrases, and vector search doubled paraphrases to 60%. But vector search *also* scored 100% on exact API names, probably because heading prefixes put the class and method names into every chunk's embedding. So hybrid had nothing to add there, and it scored 86% hit rate@5 against vector's 89%. It lost one question where BM25 matched an incidental word ("editor") strongly enough to outvote the correct vector result.

**Status:** hybrid stays implemented and selectable per request. On 36 questions the gap is a single question, too small to conclude that hybrid hurts. Next steps, in order: add questions about rare identifiers and error strings (where BM25 should matter), try weighted fusion that down-weights the BM25 list, and add a cross-encoder reranker over the fused candidates.

## No RAG framework (LangChain / LlamaIndex)

Each step is written directly against the OpenAI and Pinecone SDKs.

- **The valuable parts are custom anyway.** The RST parser, heading-aware chunker and hash-based sync are specific to this corpus; generic loaders and splitters would do them worse.
- **The rest is small.** Embedding is a batched API call, search is one `index.query`, generation is one chat call. A framework would add layers without removing much code.
- **Debuggability.** Every prompt and parameter is visible in the repo, with no hidden defaults.
- **Fewer fast-moving dependencies.**

A framework becomes the better trade when wiring many heterogeneous sources and vector stores quickly, or when its tracing and eval tooling (e.g. LangSmith) is wanted. The equivalents here would be `RecursiveCharacterTextSplitter`, `PineconeVectorStore.as_retriever()` and `EnsembleRetriever`.
