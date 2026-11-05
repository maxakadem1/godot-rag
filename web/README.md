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
- `src/lib/server/session.ts`: the password unlock. The cookie holds an expiry plus an HMAC signature, so nothing is stored server-side; the signing key includes the password, so changing it logs everyone out.
- `src/lib/server/limits.ts`: per-IP rate limits and a daily LLM answer budget in Upstash Redis, shared by every serverless instance. Falls back to memory locally.

## Access

Anyone can use recorded runs and live retrieval. LLM answers need `ACCESS_PASSWORD`. The proxy, not the browser, decides whether an answer is generated, and tells the page in a first `meta` event.

## Deploying

Import the repo into Vercel as a second project with **Root Directory `web`**. Add Upstash Redis from the Vercel Marketplace (it sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`), then set `RAG_API_URL`, `INTERNAL_API_KEY`, `ACCESS_PASSWORD` and `SESSION_SECRET`.

## Tests

```bash
npm test          # vitest: session tokens, limits, SSE parsing, run reducer
npm run typecheck
npm run lint
```
