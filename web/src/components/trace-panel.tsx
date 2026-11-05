"use client";

import { ArrowUpRight, Check, ChevronRight, Circle, Loader2, Minus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CiteRef } from "./answer";
import { Badge, HeadingPath } from "./ui";
import { steps, type Run, type Step, type StepKey } from "@/lib/run";
import type { Chunk, Hit } from "@/lib/types";
import { cn, formatMs } from "@/lib/utils";

/** One colour per stage, used for icons, the timeline and the fusion table. */
const STAGE_COLOR: Record<StepKey, { text: string; bg: string }> = {
  vector: { text: "text-vector", bg: "bg-vector" },
  keyword: { text: "text-keyword", bg: "bg-keyword" },
  fusion: { text: "text-fusion", bg: "bg-fusion" },
  context: { text: "text-primary", bg: "bg-primary" },
  generate: { text: "text-answer", bg: "bg-answer" },
};

const RRF_K = 60;

export function TracePanel({
  run,
  hovered,
  onHover,
  onClose,
  className,
}: {
  run?: Run;
  hovered: CiteRef;
  onHover: (c: CiteRef) => void;
  onClose?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState<Partial<Record<StepKey, boolean>>>({ fusion: true, context: true });
  const activeN = run && hovered?.runId === run.id ? hovered.n : null;

  // Hovering a citation in the answer opens the context step so the chunk is visible.
  const isOpen = (key: StepKey) => !!open[key] || (key === "context" && activeN !== null);

  return (
    <aside className={cn("w-[420px] shrink-0 flex-col border-l border-border bg-background", className)}>
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="font-medium">Pipeline</span>
        {run && (
          <>
            <Badge className="capitalize">{run.mode}</Badge>
            {run.status === "done" && <span className="font-mono text-[11px] text-faint">{formatMs(run.totalMs)}</span>}
          </>
        )}
        {onClose && (
          <button onClick={onClose} aria-label="Close trace" className="ml-auto text-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {!run ? (
          <Intro />
        ) : (
          <>
            <Timeline run={run} />
            <ol className="mt-3 flex flex-col gap-1">
              {steps(run).map((step) => (
                <StepRow
                  key={step.key}
                  step={step}
                  open={isOpen(step.key)}
                  onToggle={() => setOpen((o) => ({ ...o, [step.key]: !o[step.key] }))}
                >
                  <StepBody step={step} run={run} activeN={activeN} onHover={onHover} />
                </StepRow>
              ))}
            </ol>
          </>
        )}
      </div>
    </aside>
  );
}

function StepRow({
  step,
  open,
  onToggle,
  children,
}: {
  step: Step;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const color = STAGE_COLOR[step.key];
  const expandable = step.status === "done" || step.status === "skipped";
  return (
    <li className="rounded-lg border border-border">
      <button
        onClick={onToggle}
        disabled={!expandable}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left disabled:cursor-default"
      >
        <span className={cn("grid size-4 shrink-0 place-items-center", color.text)}>
          {step.status === "running" && <Loader2 className="size-3.5 animate-spin" />}
          {step.status === "done" && <Check className="size-3.5" strokeWidth={2.5} />}
          {step.status === "pending" && <Circle className="size-3 text-faint" />}
          {step.status === "skipped" && <Minus className="size-3.5 text-faint" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block font-medium", step.status === "running" && "shine", step.status === "pending" && "text-faint")}>
            {step.label}
          </span>
          <span className="block truncate text-[11px] text-faint">{step.detail}</span>
        </span>
        {step.ms !== undefined && <span className="font-mono text-[11px] text-muted">{formatMs(step.ms)}</span>}
        {expandable && (
          <ChevronRight className={cn("size-3.5 shrink-0 text-faint transition-transform", open && "rotate-90")} />
        )}
      </button>
      {open && expandable && <div className="border-t border-border px-3 py-2.5">{children}</div>}
    </li>
  );
}

function StepBody({
  step,
  run,
  activeN,
  onHover,
}: {
  step: Step;
  run: Run;
  activeN: number | null;
  onHover: (c: CiteRef) => void;
}) {
  const contextIds = new Set(run.context?.map((c) => c.id));
  switch (step.key) {
    case "vector":
      return (
        <>
          <Explain>
            The question is embedded with <Code>text-embedding-3-small</Code> and Pinecone returns the
            nearest chunks by cosine similarity. Good at meaning, even with no shared words.
          </Explain>
          <HitList hits={run.stages.vector!.hits} color="bg-vector" contextIds={contextIds} decimals={3} />
        </>
      );
    case "keyword":
      return (
        <>
          <Explain>
            BM25 scores chunks by shared words, weighted by how rare each word is. Identifiers like{" "}
            <Code>move_and_slide</Code> are kept whole, so exact API names match.
          </Explain>
          <HitList hits={run.stages.keyword!.hits} color="bg-keyword" contextIds={contextIds} decimals={1} />
        </>
      );
    case "fusion":
      return <FusionTable run={run} contextIds={contextIds} />;
    case "context":
      return (
        <>
          <Explain>
            Numbered <Code>[1]</Code>…<Code>[{run.context!.length}]</Code> and fenced as untrusted data in the
            prompt. The model may only answer from these and must cite them.
          </Explain>
          <div className="flex flex-col gap-1.5">
            {run.context!.map((c, i) => (
              <ChunkCard
                key={c.id}
                chunk={c}
                n={i + 1}
                cited={run.cited?.includes(i + 1)}
                showCited={run.cited !== undefined}
                active={activeN === i + 1}
                onHover={(on) => onHover(on ? { runId: run.id, n: i + 1 } : null)}
              />
            ))}
          </div>
        </>
      );
    case "generate":
      if (!run.generate)
        return (
          <Explain>
            Free visitors stop after retrieval: no LLM call, no cost. With the password, the model writes an
            answer from the chunks above.
          </Explain>
        );
      if (run.limited) return <Explain>{run.limited}.</Explain>;
      return (
        <Explain>
          The model cited{" "}
          {run.cited!.length ? run.cited!.map((n) => `[${n}]`).join(", ") : "nothing"}. Only cited chunks are
          returned as sources
          {run.cited!.length === 0 && ": with none cited, the docs didn't cover the question"}.
        </Explain>
      );
  }
}

function Timeline({ run }: { run: Run }) {
  type Part = { key: StepKey; label: string; ms?: number };
  const all: Part[] = [
    { key: "vector", label: "Vector", ms: run.stages.vector?.ms },
    { key: "keyword", label: "BM25", ms: run.stages.keyword?.ms },
    { key: "fusion", label: "Fusion", ms: run.stages.fusion?.ms },
    { key: "generate", label: "Answer", ms: run.generationMs },
  ];
  const parts = all.filter((p): p is Required<Part> => p.ms !== undefined);
  if (!parts.length) return null;
  const total = parts.reduce((sum, p) => sum + p.ms, 0);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex h-1.5 gap-px overflow-hidden rounded-full bg-message">
        {parts.map((p) => (
          <div
            key={p.key}
            className={cn("h-full min-w-[3px] transition-[width] duration-300", STAGE_COLOR[p.key].bg)}
            style={{ width: `${(p.ms / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5 text-muted">
            <span className={cn("size-1.5 rounded-full", STAGE_COLOR[p.key].bg)} />
            {p.label}
            <span className="font-mono text-faint">{formatMs(p.ms)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function HitList({
  hits,
  color,
  contextIds,
  decimals,
}: {
  hits: Hit[];
  color: string;
  contextIds: Set<string>;
  decimals: number;
}) {
  const [all, setAll] = useState(false);
  const max = Math.max(...hits.map((h) => h.score), 1e-9);
  const shown = all ? hits : hits.slice(0, 6);
  return (
    <div>
      <ol className="flex flex-col">
        {shown.map((h) => (
          <li key={h.id} className="relative flex items-center gap-2 py-1 text-[12px]">
            <span className="w-5 shrink-0 text-right font-mono text-[11px] text-faint">{h.rank}</span>
            <HeadingPath compact path={h.heading_path} className={cn("min-w-0 flex-1", !contextIds.has(h.id) && "opacity-60")} />
            <span className="font-mono text-[11px] text-muted">{h.score.toFixed(decimals)}</span>
            <span className={cn("absolute bottom-0 left-7 h-px opacity-50", color)} style={{ width: `calc((100% - 1.75rem) * ${h.score / max})` }} />
          </li>
        ))}
      </ol>
      {hits.length > 6 && (
        <button onClick={() => setAll(!all)} className="mt-1 text-[11px] text-faint hover:text-foreground">
          {all ? "Show fewer" : `Show all ${hits.length}`}
        </button>
      )}
    </div>
  );
}

function FusionTable({ run, contextIds }: { run: Run; contextIds: Set<string> }) {
  const [all, setAll] = useState(false);
  const rankIn = (hits?: Hit[]) => new Map(hits?.map((h) => [h.id, h.rank]));
  const vRank = rankIn(run.stages.vector?.hits);
  const kRank = rankIn(run.stages.keyword?.hits);
  const fused = run.stages.fusion!.hits;
  const shown = all ? fused : fused.slice(0, 8);

  return (
    <>
      <Explain>
        Scores from the two searches aren&apos;t comparable, so fusion uses ranks only:{" "}
        <Code>score = Σ 1 / ({RRF_K} + rank)</Code>. A chunk ranked well by both lists beats one ranked first by
        only one.
      </Explain>
      <table className="w-full table-fixed text-[12px]">
        <thead className="text-[11px] text-faint">
          <tr>
            <th className="w-5 pb-1 text-right font-normal">#</th>
            <th className="pb-1 pl-2 text-left font-normal">Chunk</th>
            <th className="w-9 pb-1 text-right font-normal text-vector">Vec</th>
            <th className="w-9 pb-1 text-right font-normal text-keyword">BM25</th>
            <th className="w-14 pb-1 text-right font-normal text-fusion">RRF</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((h) => {
            const v = vRank.get(h.id);
            const k = kRank.get(h.id);
            const inContext = contextIds.has(h.id);
            return (
              <tr key={h.id} className={cn(!inContext && "opacity-50")}>
                <td className="py-1 text-right font-mono text-[11px] text-faint">{h.rank}</td>
                <td className="truncate py-1 pl-2">
                  <span className="flex items-center gap-1.5">
                    <span
                      title={v && k ? "Found by both" : v ? "Vector only" : "BM25 only"}
                      className={cn("size-1.5 shrink-0 rounded-full", v && k ? "bg-fusion" : v ? "bg-vector" : "bg-keyword")}
                    />
                    <HeadingPath compact path={h.heading_path} />
                  </span>
                </td>
                <td className="py-1 text-right font-mono text-[11px] text-muted">{v ?? "–"}</td>
                <td className="py-1 text-right font-mono text-[11px] text-muted">{k ?? "–"}</td>
                <td className="py-1 text-right font-mono text-[11px]">{h.score.toFixed(4)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-faint">
        <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-fusion" />both</span>
        <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-vector" />vector only</span>
        <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-keyword" />BM25 only</span>
        <span>faded: not in context</span>
        {fused.length > 8 && (
          <button onClick={() => setAll(!all)} className="ml-auto hover:text-foreground">
            {all ? "Fewer" : `All ${fused.length}`}
          </button>
        )}
      </div>
    </>
  );
}

function ChunkCard({
  chunk,
  n,
  cited,
  showCited,
  active,
  onHover,
}: {
  chunk: Chunk;
  n: number;
  cited?: boolean;
  showCited: boolean;
  active: boolean;
  onHover: (on: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);
  // Chunk text starts with its "Title > Heading" line, already shown above.
  const body = chunk.text.split("\n").slice(1).join("\n").trim();

  return (
    <div
      ref={ref}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        "rounded-md border border-border transition-colors",
        active && "border-primary bg-primary/10",
        showCited && !cited && !active && "opacity-55",
      )}
    >
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <span
          className={cn(
            "grid h-4 min-w-4 place-items-center rounded px-1 font-mono text-[10px]",
            cited ? "bg-primary text-white" : "bg-message text-muted",
          )}
        >
          {n}
        </span>
        <HeadingPath compact path={chunk.heading_path} className="min-w-0 flex-1 text-[12px]" />
        {showCited && <span className={cn("text-[10px]", cited ? "text-primary" : "text-faint")}>{cited ? "cited" : "unused"}</span>}
      </button>
      {expanded && (
        <div className="border-t border-border px-2.5 py-2">
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted">
            {body}
          </pre>
          <a href={chunk.url} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1 text-[11px] text-faint hover:text-foreground">
            <span className="truncate font-mono">{chunk.path}</span>
            <ArrowUpRight className="size-3 shrink-0" />
          </a>
        </div>
      )}
    </div>
  );
}

function Intro() {
  const items: { key: StepKey; title: string; text: string }[] = [
    { key: "vector", title: "Vector search", text: "Embeds the question and finds chunks that mean the same thing, even with different words." },
    { key: "keyword", title: "Keyword search", text: "BM25 finds chunks sharing the question's words. Strong on exact API names." },
    { key: "fusion", title: "Fusion", text: "Reciprocal Rank Fusion merges both lists by rank, since their scores aren't comparable." },
    { key: "context", title: "Context", text: "The top 5 chunks are numbered and given to the model as untrusted reference text." },
    { key: "generate", title: "Answer", text: "The model answers only from those chunks and cites them as [n]." },
  ];
  return (
    <div className="px-1 py-2">
      <p className="text-muted">Ask a question or pick a recorded run, and each step appears here as it happens.</p>
      <ol className="mt-4 flex flex-col gap-3">
        {items.map((it) => (
          <li key={it.key} className="flex gap-2.5">
            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", STAGE_COLOR[it.key].bg)} />
            <span>
              <span className="font-medium">{it.title}</span>
              <span className="block text-[12px] text-muted">{it.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Explain({ children }: { children: React.ReactNode }) {
  return <p className="mb-2.5 text-[12px] text-muted">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-message px-1 font-mono text-[11px] text-foreground">{children}</code>;
}
