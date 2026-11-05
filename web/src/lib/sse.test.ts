import { describe, expect, it } from "vitest";
import { parseSSE } from "./sse";

/** A body that arrives in exactly these byte pieces, like reads off a slow network. */
function body(...pieces: (string | Uint8Array)[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pieces) c.enqueue(typeof p === "string" ? enc.encode(p) : p);
      c.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out = [];
  for await (const e of parseSSE(stream)) out.push(e);
  return out;
}

describe("parseSSE", () => {
  it("joins an event split across reads and splits several in one read", async () => {
    const events = await collect(
      body('event: token\ndata: {"te', 'xt":"Hi"}\n\nevent: done\ndata: {"ms":1}\n\nevent: token\nda', 'ta: {"text":"!"}\n\n'),
    );
    expect(events).toEqual([
      { event: "token", data: { text: "Hi" } },
      { event: "done", data: { ms: 1 } },
      { event: "token", data: { text: "!" } },
    ]);
  });

  it("keeps a multi-byte character that is split between reads", async () => {
    const bytes = new TextEncoder().encode('event: token\ndata: {"text":"é"}\n\n');
    const cut = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
    const events = await collect(body(bytes.slice(0, cut), bytes.slice(cut)));
    expect(events).toEqual([{ event: "token", data: { text: "é" } }]);
  });

  it("accepts CRLF line endings and ignores a trailing partial event", async () => {
    const events = await collect(body('event: done\r\ndata: {"ms":2}\r\n\r\nevent: tok'));
    expect(events).toEqual([{ event: "done", data: { ms: 2 } }]);
  });
});
