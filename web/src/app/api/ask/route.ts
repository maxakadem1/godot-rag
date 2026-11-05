/**
 * Proxy to the Python API's POST /ask/stream.
 *
 * The browser never talks to the API directly. This server:
 * 1. rate-limits per visitor IP (Redis, shared by every instance),
 * 2. decides whether an LLM answer is allowed: only with a valid unlock cookie and
 *    while today's answer budget lasts. The browser can't ask for one itself,
 * 3. adds the secret X-Internal-Key, which never leaves the server,
 * 4. streams the API's events straight through, after a first `meta` event saying
 *    whether an answer will follow and, if not, why.
 */
import { cookies } from "next/headers";
import { clientIp } from "@/lib/server/ip";
import { checkLimit, spendAnswer } from "@/lib/server/limits";
import { SESSION_COOKIE, verifyToken } from "@/lib/server/session";
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

  const ip = clientIp(req);
  const limit = await checkLimit("ask", ip);
  if (!limit.ok)
    return Response.json(
      { detail: `Too many questions. Try again in ${limit.retryAfterS} s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterS) } },
    );

  const unlocked = verifyToken((await cookies()).get(SESSION_COOKIE)?.value);
  let generate = false;
  let reason: "locked" | "daily_limit" | undefined;
  if (!unlocked) reason = "locked";
  else if (await spendAnswer()) generate = true;
  else reason = "daily_limit";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Client-IP": ip,
  };
  if (process.env.INTERNAL_API_KEY) headers["X-Internal-Key"] = process.env.INTERNAL_API_KEY;

  let upstream: Response;
  try {
    upstream = await fetch(`${api.replace(/\/$/, "")}/ask/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({ question, mode, k: 5, generate }),
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

  const meta = `event: meta\ndata: ${JSON.stringify({ generate, reason })}\n\n`;
  return new Response(prepend(new TextEncoder().encode(meta), upstream.body), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** A stream that yields `first`, then everything from `rest`, pulling only on demand. */
function prepend(first: Uint8Array, rest: ReadableStream<Uint8Array>) {
  const reader = rest.getReader();
  let sentFirst = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentFirst) {
        sentFirst = true;
        controller.enqueue(first);
        return;
      }
      const { value, done } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
