import { describe, expect, it } from "vitest";
import { linkCitations } from "./citations";
import { applyEvent, newRun, steps, type Run } from "./run";
import type { Chunk, RagEvent } from "./types";

const chunk = (n: number): Chunk => ({
  id: `p${n}#0`,
  path: `p${n}`,
  text: "",
  heading_path: `Page ${n}`,
  title: `Page ${n}`,
  url: "",
  score: 0,
});

const play = (run: Run, events: RagEvent[]) => events.reduce(applyEvent, run);
const status = (run: Run) => Object.fromEntries(steps(run).map((s) => [s.key, s.status]));

describe("run reducer", () => {
  it("builds a full hybrid run and marks steps as they finish", () => {
    let run = newRun("q", "hybrid", "live", true);
    expect(status(run)).toMatchObject({ vector: "running", keyword: "pending" });

    run = play(run, [
      { event: "vector", data: { ms: 900, hits: [] } },
      { event: "keyword", data: { ms: 6, hits: [] } },
      { event: "fusion", data: { ms: 0.1, hits: [] } },
      { event: "context", data: { chunks: [chunk(1), chunk(2)] } },
      { event: "token", data: { text: "Use connect() " } },
    ]);
    expect(status(run)).toMatchObject({ fusion: "done", context: "done", generate: "running" });

    run = play(run, [
      { event: "token", data: { text: "[2]." } },
      { event: "citations", data: { cited: [2], ms: 1500 } },
      { event: "done", data: { ms: 2500 } },
    ]);
    expect(run.answer).toBe("Use connect() [2].");
    expect(run.cited).toEqual([2]);
    expect(run.status).toBe("done");
    expect(Object.values(status(run))).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("lets the server's meta event overrule the UI's guess", () => {
    const locked = applyEvent(newRun("q", "vector", "live", true), {
      event: "meta",
      data: { generate: false, reason: "locked" },
    });
    expect(locked.generate).toBe(false);
    expect(locked.limited).toBeUndefined();

    const limited = applyEvent(newRun("q", "vector", "live", true), {
      event: "meta",
      data: { generate: false, reason: "daily_limit" },
    });
    expect(limited.limited).toMatch(/limit/);
    const done = play(limited, [{ event: "context", data: { chunks: [chunk(1)] } }]);
    expect(steps(done).at(-1)).toMatchObject({ status: "skipped", detail: expect.stringMatching(/limit/) });
  });

  it("only includes the steps a mode uses", () => {
    expect(steps(newRun("q", "keyword", "live", false)).map((s) => s.key)).toEqual([
      "keyword",
      "context",
      "generate",
    ]);
  });
});

describe("linkCitations", () => {
  it("links [n] in prose but not inside code", () => {
    const md = "Call it [1][2].\n\n```gdscript\nvar a = arr[1]\n```\n\nUse `x[3]` here [3].";
    expect(linkCitations(md)).toBe(
      "Call it [1](#cite-1)[2](#cite-2).\n\n```gdscript\nvar a = arr[1]\n```\n\nUse `x[3]` here [3](#cite-3).",
    );
  });

  it("leaves an unfinished code block alone while the answer streams", () => {
    expect(linkCitations("See [1].\n```gd\narr[2]")).toBe("See [1](#cite-1).\n```gd\narr[2]");
  });
});
