# Godot Docs RAG

Ask questions about the [Godot Engine](https://godotengine.org) in plain English and get answers grounded in the official documentation, with links to the pages they came from.

Built with Retrieval-Augmented Generation (RAG): the docs are split into chunks and indexed with vector embeddings. For each question, the most relevant chunks are retrieved and passed to an LLM, which answers using only that text.

```
OFFLINE (indexing, re-run when docs change)
  godot-docs repo ─► parse ─► chunk ─► embed ─► Postgres + pgvector
                     (code)   (code)  (embedding        ▲
                                        model)          │ search
ONLINE (per question)                                   │
  question ─► embed ─► vector + keyword search ─────────┘
                          │
                          ▼
                 top chunks' text + question ─► LLM ─► answer + sources
```

## Status

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Ingest: fetch docs, parse RST into clean sections + metadata | ✅ done |
| 2 | Chunk + embed into pgvector, with content hashes | ⬜ |
| 3 | Retrieval API: vector search, then hybrid (vector + keyword) | ⬜ |
| 4 | Generation: grounded answers with citations | ⬜ |
| 5 | Evaluation: question set + retrieval/answer metrics | ⬜ |
| 6 | Sync: re-embed only changed pages on docs updates | ⬜ |
| 7 | Frontend: Next.js chat UI with streaming + sources | ⬜ |
| 8 | Write-up: architecture diagram + eval results in this README | ⬜ |

Details and acceptance criteria: [docs/04-roadmap.md](docs/04-roadmap.md).

## Quick start

Requirements: Python 3.11+, Docker, git, an OpenAI API key (needed from milestone 2).

```bash
# 1. Install
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env               # then add your OPENAI_API_KEY

# 2. Start Postgres + pgvector (schema in db/init.sql is applied automatically)
docker compose up -d

# 3. Ingest the docs -> data/documents.jsonl
rag-ingest                         # clones/pulls godot-docs, parses ~1,600 pages
rag-ingest --no-fetch              # re-parse the existing checkout

# 4. Tests
pytest

# API (stub for now)
uvicorn rag.api:app --reload       # http://localhost:8000/docs
```

## Project layout

```
db/init.sql              Postgres schema: documents, chunks (vector + full-text indexes)
src/rag/
  config.py              Settings from .env
  models.py              Document / Section / Chunk / RetrievedChunk
  ingest/
    fetch.py             Clone/pull the godot-docs repo
    parse_rst.py         RST -> clean text split by headings (plain code, no LLM)
    run.py               `rag-ingest` CLI
  chunking.py            [M2] Split sections into ~300-500 token chunks
  embeddings.py          [M2] OpenAI embeddings, batched
  db.py                  [M2] Upserts, deletes, connection
  retrieval.py           [M3] Vector / keyword / hybrid search
  generation.py          [M4] Prompt building + LLM call
  api.py                 FastAPI app
eval/                    [M5] Question set + eval scripts
frontend/                [M7] Next.js chat UI
tests/                   pytest
docs/                    Design notes (start here)
```

## Docs

1. [RAG concepts](docs/01-rag-concepts.md): what RAG is, embeddings, what "dynamic" retrieval means
2. [Architecture](docs/02-architecture.md): the pipeline, which parts are AI and which are plain code, chunking
3. [Production considerations](docs/03-production-considerations.md): what turns a demo into a production system
4. [Roadmap](docs/04-roadmap.md): milestones, acceptance criteria, known gaps
5. [Decisions](docs/05-decisions.md): why these tools and trade-offs

## Data

Source: [godotengine/godot-docs](https://github.com/godotengine/godot-docs) (`stable` branch), licensed CC BY 3.0. Answers link back to [docs.godotengine.org](https://docs.godotengine.org).
