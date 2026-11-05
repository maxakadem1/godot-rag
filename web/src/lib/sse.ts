import type { RagEvent } from "./types";

/**
 * Parse a Server-Sent Events body into events as they arrive.
 *
 * Network chunks don't line up with events: one read can hold half an event or
 * several, so text is buffered until a blank line ("\n\n") closes an event.
 */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<RagEvent> {
  const reader = body.getReader();
  // stream: true keeps a multi-byte character that is split across reads intact.
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = parseBlock(block);
        if (event) yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): RagEvent | null {
  let name = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  return { event: name, data: JSON.parse(data.join("\n")) } as RagEvent;
}
