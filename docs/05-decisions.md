# Decisions

Short records of choices and why. Add one whenever you make a non-obvious call; they're useful in interviews.

## Dataset: the Godot docs

- Public and openly licensed (CC BY 3.0), so there are no permission problems
- Large (~1,600 pages), so retrieval quality actually matters
- Changes regularly, which gives a real sync story
- Easy to judge whether an answer is right, so it's good for building an eval set
- Mixes prose tutorials with an API reference, which exercises both semantic and keyword search

## Language: Python

Most LLM and RAG tooling (OpenAI/Anthropic SDKs, embeddings, eval libraries, Pydantic) is Python-first, and it's what AI-engineering roles ask for. The frontend stays in Next.js/TypeScript.

## Parsing with code, not an LLM

Running every page through an LLM to "normalize" it is slow and expensive at scale, and it can silently drop or change content. Each source format has structure that code can convert deterministically. An LLM is reserved for genuinely messy input.

## One provider (OpenAI) for embeddings and answers

One API key and one bill. The embedding model and the chat model are independent: the chat model never sees vectors, only chunk text, so either can be swapped later. Anthropic has no embedding model, so using Claude for answers would still mean a second provider for embeddings (OpenAI or Voyage AI).

## Embedding model: OpenAI `text-embedding-3-small` (1536 dims)

Cheap enough to re-embed the whole corpus freely (~2.7M tokens) and good quality for English docs. Changing models means a new Pinecone index with the new dimension (`EMBEDDING_DIMENSIONS`) and re-embedding everything. Vectors from different models can't be mixed. Worth comparing against `text-embedding-3-large` or Voyage `voyage-4` once the eval set exists.

## Vector store: Pinecone (serverless)

- Managed: nothing to install or run, and the free Starter plan easily holds ~10k chunks
- Stores the chunk text in metadata, so search returns everything the prompt and citations need in one call
- Supports sparse vectors for the keyword half of hybrid search
- Trade-offs vs Postgres + pgvector: one more external service, and no relational table for documents, so a small manifest file (`data/index_manifest.json`) tracks content hashes for sync

## Hybrid search planned from the start

Questions about Godot often contain exact API names (`move_and_slide`, `CharacterBody2D`). Embeddings are weak on exact identifiers, while keyword search is strong on them. With Pinecone, the keyword half uses sparse vectors (e.g. its hosted `pinecone-sparse-english-v0` model), merged with dense results via Reciprocal Rank Fusion.
