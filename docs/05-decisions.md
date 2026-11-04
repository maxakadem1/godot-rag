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

## Embedding model: OpenAI `text-embedding-3-small` (1536 dims)

Cheap enough to re-embed the whole corpus freely (~2.7M tokens) and good quality for English docs. Changing models means changing `vector(1536)` in `db/init.sql` and re-embedding everything. Vectors from different models can't be mixed.

## Vector store: Postgres + pgvector

- One database handles vectors, full-text search (for hybrid) and normal relational data
- It's what many companies already run, so it's closer to a real production setup than a hosted-only vector DB
- HNSW index for fast approximate nearest-neighbour search; GIN index for full-text

## Hybrid search planned from the start

Questions about Godot often contain exact API names (`move_and_slide`, `CharacterBody2D`). Embeddings are weak on exact identifiers, while keyword search is strong on them. The schema includes a generated `tsv` column so adding keyword search later needs no migration.
