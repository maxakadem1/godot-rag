import { parseSSE } from "./sse";
import type { ReplayFile } from "./replays";
import type { Mode, RagEvent } from "./types";

/** Play a recorded run back at its original pace. */
export async function* playReplay(
  replay: ReplayFile,
  signal: AbortSignal,
  speed = 1,
): AsyncGenerator<RagEvent> {
  const start = performance.now();
  for (const { t, ...event } of replay.events) {
    const wait = t / speed - (performance.now() - start);
    if (wait > 0) await sleep(wait, signal);
    if (signal.aborted) return;
    yield event as RagEvent;
  }
}

/** Ask the API through this app's /api/ask proxy and stream the events back. */
export async function* streamLive(
  question: string,
  mode: Mode,
  signal: AbortSignal,
): AsyncGenerator<RagEvent> {
  let res: Response;
  try {
    res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, mode }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) return;
    yield* failed(err instanceof Error ? err.message : "Network error");
    return;
  }
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    yield* failed(body?.detail ?? `Request failed (${res.status})`);
    return;
  }
  yield* parseSSE(res.body);
}

function* failed(detail: string): Generator<RagEvent> {
  yield { event: "error", data: { detail } };
  yield { event: "done", data: { ms: 0 } };
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });
}
