# Godot Docs RAG

[![CI](https://github.com/maxakadem1/godot-rag/actions/workflows/ci.yml/badge.svg)](https://github.com/maxakadem1/godot-rag/actions/workflows/ci.yml)

Ask questions about the [Godot Engine](https://godotengine.org) in plain English and get answers grounded in the official documentation, with links to the exact pages they came from.

A retrieval-augmented generation (RAG) pipeline built directly on the OpenAI and Pinecone SDKs, without a RAG framework: a custom reStructuredText parser, heading-aware token chunking, incremental hash-based sync, hybrid vector + BM25 retrieval fused with RRF, grounded generation with citations, and an evaluation harness to measure every change.

```
OFFLINE  godot-docs ─► parse ─► chunk ─► embed ─► Pinecone          (only changed pages re-embedded)

ONLINE   question ─┬─► vector search (Pinecone) ─┐
                   └─► keyword search (BM25) ────┴─► RRF ─► top-k chunks ─► LLM ─► answer + cited sources
```

## Highlights

- **Ingestion without an LLM.** A deterministic RST/Sphinx converter turns 1,565 pages into clean, heading-split sections: code blocks fenced, admonitions labelled, roles and links reduced to readable text, class-reference noise removed.
- **Heading-aware chunking.** 8,580 chunks of ≤ 500 tokens. Sections split at paragraph and code-block boundaries with 50-token overlap, tiny sections merged, every chunk prefixed with its `Title > Heading` path. Limits are measured with the embedding model's own tokenizer.
- **Incremental, crash-safe sync.** Per-page content hashes and deterministic chunk ids (`path#n`) mean re-runs only embed changed pages, trim chunks from pages that shrank, delete removed pages, and are idempotent if interrupted.
- **Hybrid retrieval.** Pinecone cosine search plus a hand-written in-memory BM25 index that keeps `snake_case` identifiers intact, merged with Reciprocal Rank Fusion.
- **Grounded answers.** Excerpts are numbered and fenced as untrusted data (tag-injection stripped). The model must cite `[n]`, says so when the docs don't cover a question, and is never called when nothing is retrieved. Only the sources actually cited are returned.
- **Measured, not guessed.** 38 labelled questions split by type (exact API name / concept / paraphrase / unanswerable), scored with hit rate@k and MRR per search mode. Vector search reaches 89% hit rate@5 and 0.81 MRR.
- **Production basics.** Validated requests, 502/503 error mapping for provider failures and missing config, per-request logging of retrieved and cited chunks, 57 offline tests with fake LLM, embedder and vector store, and CI running ruff and pytest on Python 3.11 to 3.13.

## Results

Retrieval on the 36 answerable questions, top 5 chunks:

| Mode | Hit rate@5 | MRR | Exact API (n=14) | Concept (n=12) | Paraphrase (n=10) |
|---|---|---|---|---|---|
| Keyword (BM25) | 78% | 0.58 | 100% | 92% | 30% |
| Vector | **89%** | **0.81** | 100% | 100% | **60%** |
| Hybrid (RRF) | 86% | 0.79 | 100% | 92% | **60%** |

What the numbers say:

- **Embeddings doubled paraphrase recall** (30% → 60%) and lifted MRR from 0.58 to 0.81. Questions like "my game freezes when I switch to a big level" share almost no words with the right page.
- **Hybrid did not beat vector on this set.** The hypothesis behind hybrid was that embeddings would miss exact API names, but vector search already scores 100% on them, likely because every chunk is prefixed with its class and method heading. Hybrid lost one concept question: BM25 matched "editor" in "run without the editor" and pushed `exporting_projects.rst` out of the top 5.
- With 36 questions, one question is ~3 points, so vector vs hybrid is within noise. The next experiments are a weighted fusion or reranker, and more questions about rare identifiers and error messages, which is where keyword search should earn its place.
- The remaining misses are hard paraphrases (line of sight → ray-casting, walking around obstacles → navigation agents, keeping score across levels → autoloads). Those are the cases for query rewriting or a reranker.

Full index run: 1,565 pages → 8,580 chunks, 2.55M tokens embedded in ~2 minutes for ~$0.05. Reproduce with `rag-eval`; see [eval/README.md](eval/README.md).

## Quick start

Requires Python 3.11+ and git. Indexing and answering need an OpenAI API key and a Pinecone API key (the free tier is enough; the index is created on first run).

```bash
python -m venv .venv
source .venv/bin/activate              # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env                   # add OPENAI_API_KEY and PINECONE_API_KEY
```

```bash
rag-ingest                             # clone godot-docs, parse to data/documents.jsonl
rag-index --limit 20                   # cheap test run
rag-index                              # full index: ~8.6k chunks, ~2.6M tokens, ~$0.05
rag-eval                               # retrieval metrics per search mode
uvicorn rag.api:app --reload           # API + interactive docs at http://localhost:8000/docs
```

Keyword search and `rag-eval --modes keyword` work without any API keys once `rag-ingest` has run.

### API

```bash
curl -X POST localhost:8000/ask -H "Content-Type: application/json" \
  -d '{"question": "How do I connect a signal in code?"}'
```

Response shape (abridged):

```json
{
  "answer": "Call connect() on the signal and pass the method to run [1] ...",
  "sources": [
    {"n": 1, "title": "Using signals", "url": "https://docs.godotengine.org/en/stable/getting_started/step_by_step/signals.html", "heading_path": "Using signals > Connecting a signal in code"}
  ]
}
```

| Endpoint | Description |
|---|---|
| `POST /ask` | `{question, mode?, k?}` → answer with cited sources |
| `POST /ask/stream` | Same, as Server-Sent Events: each search stage, the context, answer tokens, citations. `generate: false` stops after retrieval |
| `GET /search?q=&mode=&k=` | Retrieval only, with scores; for debugging answers |
| `GET /health` | Liveness |

`mode` is `hybrid` (default), `vector` or `keyword`; `k` is 1 to 20.

**Protection for a public deployment.** With `INTERNAL_API_KEY` set, every endpoint except `/health` requires it in the `X-Internal-Key` header, so only the web frontend's server can call the API. Requests are rate-limited per client IP (`RATE_LIMIT_PER_MINUTE`, using the `X-Client-IP` the frontend forwards), and LLM answers are capped per UTC day across all users (`DAILY_ANSWER_LIMIT`); past the cap, retrieval still works. Limits live in process memory, which assumes a single API instance.

## Deploying the API

The API runs as one always-on [Fly.io](https://fly.io) machine (config in `fly.toml`, image in `Dockerfile`). The image carries `data/documents.jsonl` for the BM25 index, so deploy from a machine where `rag-ingest` has run; `.dockerignore` is an allow-list, so `.env` and the docs checkout never leave your machine.

```bash
fly launch --no-deploy --copy-config          # once: creates the app from fly.toml
fly secrets set OPENAI_API_KEY=... PINECONE_API_KEY=... INTERNAL_API_KEY=...
fly deploy --ha=false                         # one machine: the limits are in memory
```

Generate `INTERNAL_API_KEY` with `python -c "import secrets; print(secrets.token_urlsafe(32))"` and give the same value to the web frontend. Without it the API is open to anyone with the URL.

## Project layout

```
src/rag/
  ingest/fetch.py      clone / update the godot-docs repo
  ingest/parse_rst.py  RST → clean sections + metadata
  ingest/run.py        rag-ingest CLI
  chunking.py          heading-aware, token-limited chunking
  embeddings.py        batched OpenAI embeddings
  store.py             Pinecone records, deletes, manifest
  indexing.py          rag-index CLI: incremental sync
  keyword.py           in-memory BM25
  retrieval.py         vector, keyword, hybrid (RRF)
  generation.py        prompt, LLM call, citations
  evaluate.py          rag-eval CLI: hit rate@k, MRR
  api.py               FastAPI app
eval/questions.jsonl   labelled question set
tests/                 pytest, fully offline
docs/                  architecture and design decisions
```

## Further reading

- [Architecture](docs/architecture.md): each pipeline stage, the data model, sync rules, prompt design
- [Design decisions](docs/decisions.md): why these tools, and the trade-offs against the alternatives

## Limitations and next steps

- **Retrieval:** add a cross-encoder reranker over the top ~20 candidates, try weighted fusion so BM25 can't outvote a strong vector match, sweep chunk size (300 vs 500), and grow the eval set; 36 answerable questions can't separate vector from hybrid.
- **Answer quality:** retrieval metrics don't show whether the answer is faithful to the excerpts. Next is an LLM-as-judge pass for faithfulness and relevance, checked against human labels on a sample.
- **Conversation:** each question is answered independently. Follow-ups ("what about 3D?") need rewriting into standalone questions before search, and answers aren't streamed yet.
- **Parser gaps:** grid and list tables come through as ASCII, the class reference's summary tables (`.. table::`) are dropped (the full method descriptions are kept), and `::` literal blocks stay as indented text rather than fenced code.
- **Scale:** the BM25 index lives in each API process and is rebuilt at startup. Fine for ~10k chunks; at larger scale it would move to OpenSearch or Pinecone sparse vectors.
- **Frontend:** a web chat UI is planned, with streamed answers, clickable sources and a selector for hybrid (default), vector or keyword search.
- **Sync** is a manual `rag-ingest && rag-index`; a scheduled job (cron or GitHub Actions) would keep the index current.

## Data and attribution

Documentation content comes from [godotengine/godot-docs](https://github.com/godotengine/godot-docs) (`stable` branch), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Answers link back to [docs.godotengine.org](https://docs.godotengine.org).
