"use client";

import { AlertTriangle, ArrowUpRight, Lock, PanelRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { Answer, type CiteRef } from "./answer";
import { Badge, HeadingPath, OutcomeDot } from "./ui";
import { REPLAYS } from "@/lib/replays";
import { steps, type Run } from "@/lib/run";
import { cn, formatMs } from "@/lib/utils";

type TurnProps = {
  hovered: CiteRef;
  onHover: (c: CiteRef) => void;
  onShowTrace: (runId: string) => void;
  onUnlock: () => void;
};

export function Thread({
  runs,
  selectedId,
  ...rest
}: { runs: Run[]; selectedId?: string } & TurnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // A new question always scrolls into view; while it streams, stay pinned to the
  // bottom unless the reader has scrolled up.
  useEffect(() => {
    stick.current = true;
  }, [runs.length]);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  return (
    <div
      ref={ref}
      onScroll={() => {
        const el = ref.current!;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex max-w-[46rem] flex-col gap-8 px-4 py-6">
        {runs.map((run) => (
          <Turn key={run.id} run={run} selected={run.id === selectedId} {...rest} />
        ))}
      </div>
    </div>
  );
}

function Turn({
  run,
  selected,
  hovered,
  onHover,
  onShowTrace,
  onUnlock,
}: { run: Run; selected: boolean } & TurnProps) {
  const replay = run.replayId ? REPLAYS.find((r) => r.id === run.replayId) : undefined;
  const running = steps(run).find((s) => s.status === "running");
  const sources = (run.cited ?? []).map((n) => ({ n, chunk: run.context?.[n - 1] }));

  return (
    <section className="fade-in">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl bg-message px-3.5 py-2">{run.question}</p>
      </div>

      <div
        className={cn(
          "mt-4 rounded-xl border px-4 py-3 transition-colors",
          selected ? "border-border-strong" : "border-transparent",
        )}
      >
        <div className="mb-2 flex items-center gap-2 text-[11px] text-faint">
          <Badge>{run.source === "replay" ? "Recorded run" : "Live"}</Badge>
          <span className="capitalize">{run.mode}</span>
          <span>·</span>
          {run.status === "running" ? (
            <span className="shine">{running ? `${running.label}…` : "Working…"}</span>
          ) : (
            <span className="font-mono">{formatMs(run.totalMs)}</span>
          )}
          <button
            onClick={() => onShowTrace(run.id)}
            className={cn(
              "ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-message hover:text-foreground",
              selected && "text-muted",
            )}
          >
            <PanelRight className="size-3" strokeWidth={1.75} />
            {selected ? "In trace" : "Show trace"}
          </button>
        </div>

        {run.error && (
          <p className="flex items-center gap-2 text-danger">
            <AlertTriangle className="size-3.5" />
            {run.error}
          </p>
        )}

        {run.generate && run.answer && (
          <Answer
            text={run.answer}
            runId={run.id}
            nChunks={run.context?.length ?? 0}
            hovered={hovered}
            onHover={onHover}
            onCiteClick={() => onShowTrace(run.id)}
            streaming={run.status === "running"}
          />
        )}

        {!run.generate && run.context && (
          <RetrievalOnly run={run} hovered={hovered} onHover={onHover} onUnlock={onUnlock} />
        )}

        {sources.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-1.5 text-[11px] text-faint">Sources</div>
            <ul className="flex flex-col gap-1">
              {sources.map(({ n, chunk }) =>
                chunk ? (
                  <li key={n}>
                    <a
                      href={chunk.url}
                      target="_blank"
                      rel="noreferrer"
                      onMouseEnter={() => onHover({ runId: run.id, n })}
                      onMouseLeave={() => onHover(null)}
                      className="group flex items-center gap-2 text-[12px]"
                    >
                      <span className="grid h-4 min-w-4 place-items-center rounded bg-primary/15 px-1 font-mono text-[10px] text-primary">
                        {n}
                      </span>
                      <HeadingPath path={chunk.heading_path} className="group-hover:underline" />
                      <ArrowUpRight className="size-3 shrink-0 text-faint" />
                    </a>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        )}

        {replay && run.status === "done" && (
          <p className="mt-4 flex gap-2.5 rounded-lg bg-message px-3 py-2 text-[12px] text-muted">
            <OutcomeDot outcome={replay.outcome} className="mt-1.5" />
            <span>
              <span className="text-foreground capitalize">{replay.outcome}. </span>
              {replay.note}
            </span>
          </p>
        )}
      </div>
    </section>
  );
}

function RetrievalOnly({
  run,
  hovered,
  onHover,
  onUnlock,
}: {
  run: Run;
  hovered: CiteRef;
  onHover: (c: CiteRef) => void;
  onUnlock: () => void;
}) {
  return (
    <div>
      {run.limited ? (
        <p className="text-muted">{run.limited}. These are the chunks the answer would be built from.</p>
      ) : (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
          <Lock className="size-3.5 shrink-0" strokeWidth={1.75} />
          Retrieval only: these are the chunks an answer would be built from.
          <button onClick={onUnlock} className="text-foreground underline underline-offset-2 hover:text-primary">
            Unlock answers
          </button>
        </p>
      )}
      <ol className="mt-3 flex flex-col gap-1">
        {run.context!.map((c, i) => (
          <li
            key={c.id}
            onMouseEnter={() => onHover({ runId: run.id, n: i + 1 })}
            onMouseLeave={() => onHover(null)}
            className={cn(
              "flex items-center gap-2 rounded-md px-1.5 py-1 text-[12px]",
              hovered?.runId === run.id && hovered.n === i + 1 && "bg-message",
            )}
          >
            <span className="grid h-4 min-w-4 place-items-center rounded bg-message px-1 font-mono text-[10px] text-muted">
              {i + 1}
            </span>
            <HeadingPath path={c.heading_path} />
            <a href={c.url} target="_blank" rel="noreferrer" className="ml-auto text-faint hover:text-foreground">
              <ArrowUpRight className="size-3" />
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
