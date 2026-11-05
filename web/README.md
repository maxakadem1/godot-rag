# Godot Docs RAG: web

Next.js frontend that shows every step of the RAG pipeline as it runs: vector search, BM25, rank fusion, the context sent to the model, and the cited answer.

```bash
cp .env.example .env.local     # RAG_API_URL, INTERNAL_API_KEY
npm install
npm run dev                    # http://localhost:3000
```

Run the Python API alongside it (`uvicorn rag.api:app` in the repo root) for live questions. Recorded runs work without it.

## How it fits together

- `src/app/api/ask/route.ts`: server-side proxy to the API's `POST /ask/stream`. It holds `INTERNAL_API_KEY` and forwards the visitor's IP, so the browser never sees the key.
- `src/lib/sse.ts`: parses the Server-Sent Events stream as it arrives.
- `src/lib/run.ts`: a pure reducer that builds a `Run` from events. Live streams and recorded replays feed the same reducer.
- `src/data/replays/`: real runs recorded with `scripts/record_replays.py`, played back at their original timing.
- `src/components/trace-panel.tsx`: the pipeline view: timeline, per-stage results, fusion table, context chunks.
