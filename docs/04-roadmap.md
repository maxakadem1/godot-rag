# Roadmap

Milestones 1–5 make a solid project; 6–8 make it stand out. Keep a short log of results at each step. The eval numbers are what makes the final write-up convincing.

## ✅ 1. Ingest

- [x] Shallow-clone / pull `godotengine/godot-docs` (`stable`)
- [x] Parse RST → sections by heading, with title, URL, heading path
- [x] Content hash per page
- [x] Tests for the parser
- [x] `rag-ingest` CLI → `data/documents.jsonl`

**Known gaps in the parser** (fix if eval shows they matter):
- Grid/list tables come through as raw ASCII. Could be converted to Markdown tables or "key: value" lines.
- The class reference's summary tables (Properties/Methods lists) are dropped as `.. table::` directives. The full descriptions further down are kept.
- Literal blocks introduced with `::` are kept as indented text, not fenced code.
- `:ref:` labels without link text are guessed from the label name (`doc_first_script` → "first script").

## ⬜ 2. Chunk + embed

- [ ] `chunk_document()`: heading-aware, ~300–500 tokens, ~50 overlap, merge tiny sections, title + heading prefix
- [ ] Unit tests: no chunk over the max, nothing lost, order preserved
- [ ] `embed_texts()`: batched, retries with backoff
- [ ] `db.py`: upsert documents, replace chunks, delete pages that no longer exist
- [ ] CLI `rag-index`: documents.jsonl → chunks → embeddings → Postgres; skip pages whose hash is unchanged
- [ ] Log: chunk count, tokens embedded, cost, time

## ⬜ 3. Retrieval

- [ ] Vector search with pgvector
- [ ] Keyword search with Postgres full-text
- [ ] Hybrid with Reciprocal Rank Fusion
- [ ] `/search` endpoint for debugging (returns chunks + scores, no LLM)
- [ ] (Later) reranker

## ⬜ 4. Generation

- [ ] Prompt with context, citations and an "I don't know" rule
- [ ] `/ask` endpoint returning answer + sources
- [ ] Streaming response
- [ ] Follow-up question rewriting

## ⬜ 5. Evaluation

- [ ] 30–50 real questions in `eval/questions.jsonl` with expected source pages, mixing tutorials, class reference and exact-API-name questions
- [ ] Retrieval metrics: hit rate@5, MRR
- [ ] Answer metrics: faithfulness + relevance (LLM-as-judge)
- [ ] Results table comparing configurations, e.g. vector-only vs hybrid, chunk 300 vs 500

## ⬜ 6. Sync

- [ ] Scheduled job (cron / GitHub Action): pull docs → re-parse → re-embed only changed pages → delete removed pages
- [ ] Log what changed per run

## ⬜ 7. Frontend

- [ ] Next.js chat UI in `frontend/`: streaming, clickable sources, feedback buttons, loading/error states

## ⬜ 8. Write-up

- [ ] Architecture diagram
- [ ] Eval results table and what each change did
- [ ] Short demo GIF
- [ ] (Optional) deploy
