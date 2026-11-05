/** Shapes of the events streamed by the API's POST /ask/stream (see src/rag/api.py). */

export type Mode = "hybrid" | "vector" | "keyword";
export const MODES: Mode[] = ["hybrid", "vector", "keyword"];

/** A search result without its text, as listed in the vector / keyword / fusion stages. */
export type Hit = {
  id: string;
  rank: number;
  score: number;
  title: string;
  heading_path: string;
  url: string;
};

/** A chunk sent to the LLM. chunks[i] is cited as [i + 1]. */
export type Chunk = {
  id: string;
  path: string;
  text: string;
  heading_path: string;
  title: string;
  url: string;
  score: number;
};

export type StageName = "vector" | "keyword" | "fusion";

export type RagEvent =
  | { event: StageName; data: { ms: number; hits: Hit[] } }
  | { event: "context"; data: { chunks: Chunk[] } }
  | { event: "token"; data: { text: string } }
  | { event: "citations"; data: { cited: number[]; ms: number } }
  | { event: "limited" | "error"; data: { detail: string } }
  | { event: "done"; data: { ms: number } };
