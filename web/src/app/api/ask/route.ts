/**
 * Proxy to the Python API's POST /ask/stream.
 *
 * The browser never talks to the API directly: this server adds the secret
 * X-Internal-Key (which stays on the server) and the visitor's IP for rate limiting,
 * then streams the API's events straight through.
 *
 * For now every visitor gets retrieval only (generate: false). The password unlock
 * and Redis-backed limits come next.
 */
import { MODES, type Mode } from "@/lib/types";

export const maxDuration = 60;

export async function POST(req: Request) {
  const api = process.env.RAG_API_URL;
  if (!api) return Response.json({ detail: "RAG_API_URL is not set" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 1000)
    return Response.json({ detail: "Question must be 1 to 1000 characters" }, { status: 400 });
  const mode: Mode = MODES.includes(body?.mode) ? body.mode : "hybrid";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Client-IP": clientIp(req),
  };
  if (process.env.INTERNAL_API_KEY) headers["X-Internal-Key"] = process.env.INTERNAL_API_KEY;

  let upstream: Response;
  try {
    upstream = await fetch(`${api.replace(/\/$/, "")}/ask/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({ question, mode, k: 5, generate: false }),
      signal: req.signal,
    });
  } catch {
    return Response.json({ detail: "The RAG API is unreachable" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.json().catch(() => null))?.detail;
    const status = upstream.status === 429 ? 429 : 502;
    return Response.json({ detail: detail ?? `RAG API error ${upstream.status}` }, { status });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** On Vercel, x-forwarded-for is set by the platform, so its first entry is the visitor. */
function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
