import type { Chunk, Hit, Mode, RagEvent, StageName } from "./types";

/** Everything known about one question's run, built up event by event. */
export type Run = {
  id: string;
  question: string;
  mode: Mode;
  source: "replay" | "live";
  /** Set for replays, to show what the recorded run demonstrates. */
  replayId?: string;
  /** false: retrieval only, no LLM answer (free tier). */
  generate: boolean;
  status: "running" | "done";
  stages: Partial<Record<StageName, { ms: number; hits: Hit[] }>>;
  context?: Chunk[];
  answer: string;
  cited?: number[];
  generationMs?: number;
  totalMs?: number;
  limited?: string;
  error?: string;
};

export function newRun(
  question: string,
  mode: Mode,
  source: Run["source"],
  generate: boolean,
): Run {
  return {
    id: crypto.randomUUID(),
    question,
    mode,
    source,
    generate,
    status: "running",
    stages: {},
    answer: "",
  };
}

/** Pure reducer: the same function handles live streams and replays. */
export function applyEvent(run: Run, e: RagEvent): Run {
  switch (e.event) {
    case "vector":
    case "keyword":
    case "fusion":
      return { ...run, stages: { ...run.stages, [e.event]: e.data } };
    case "context":
      return { ...run, context: e.data.chunks };
    case "token":
      return { ...run, answer: run.answer + e.data.text };
    case "citations":
      return { ...run, cited: e.data.cited, generationMs: e.data.ms };
    case "limited":
      return { ...run, limited: e.data.detail };
    case "error":
      return { ...run, error: e.data.detail };
    case "done":
      return { ...run, status: "done", totalMs: e.data.ms };
  }
}

export type StepKey = StageName | "context" | "generate";
export type Step = {
  key: StepKey;
  label: string;
  detail: string;
  status: "pending" | "running" | "done" | "skipped";
  ms?: number;
};

/** The pipeline steps this run goes through, with each one's progress. */
export function steps(run: Run): Step[] {
  const { stages, context } = run;
  const list: Omit<Step, "status">[] = [];
  if (run.mode !== "keyword")
    list.push({
      key: "vector",
      label: "Vector search",
      detail: stages.vector
        ? `${stages.vector.hits.length} nearest chunks by meaning`
        : "Embed the question, query Pinecone",
      ms: stages.vector?.ms,
    });
  if (run.mode !== "vector")
    list.push({
      key: "keyword",
      label: "Keyword search",
      detail: stages.keyword
        ? `${stages.keyword.hits.length} chunks by BM25 word match`
        : "BM25 over 8,580 chunks",
      ms: stages.keyword?.ms,
    });
  if (run.mode === "hybrid")
    list.push({
      key: "fusion",
      label: "Fusion",
      detail: stages.fusion
        ? `${stages.fusion.hits.length} candidates merged by rank (RRF)`
        : "Reciprocal Rank Fusion",
      ms: stages.fusion?.ms,
    });
  list.push({
    key: "context",
    label: "Context",
    detail: context ? `Top ${context.length} chunks sent to the model` : "Pick the top chunks",
  });
  list.push({
    key: "generate",
    label: "Answer",
    detail: !run.generate
      ? "Skipped: retrieval only"
      : run.limited
        ? "Skipped: daily answer limit reached"
        : run.cited
          ? `Cited ${run.cited.length} of ${context?.length ?? 0} chunks`
          : "LLM writes a cited answer",
    ms: run.generationMs,
  });

  const isDone = (key: StepKey) =>
    key === "context"
      ? !!context
      : key === "generate"
        ? run.cited !== undefined
        : !!stages[key];
  const isSkipped = (key: StepKey) => key === "generate" && (!run.generate || !!run.limited);

  let runningAssigned = false;
  return list.map((s) => {
    if (isSkipped(s.key) && (run.status === "done" || !!context))
      return { ...s, status: "skipped" };
    if (isDone(s.key)) return { ...s, status: "done" };
    if (run.status === "running" && !runningAssigned && !run.error) {
      runningAssigned = true;
      return { ...s, status: "running" };
    }
    return { ...s, status: "pending" };
  });
}
