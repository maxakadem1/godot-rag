"use client";

import { PanelRight, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CiteRef } from "./answer";
import { Composer } from "./composer";
import { EmptyState } from "./empty-state";
import { LogoMark } from "./logo";
import { Sidebar } from "./sidebar";
import { Thread } from "./thread";
import { TracePanel } from "./trace-panel";
import { UnlockDialog } from "./unlock-dialog";
import type { Replay } from "@/lib/replays";
import { applyEvent, newRun, type Run } from "@/lib/run";
import { playReplay, streamLive } from "@/lib/sources";
import type { Mode, RagEvent } from "@/lib/types";

export function AppShell() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [mode, setMode] = useState<Mode>("hybrid");
  const [hovered, setHovered] = useState<CiteRef>(null);
  const [traceOpen, setTraceOpen] = useState(false); // overlay on narrow screens
  const [unlocked, setUnlocked] = useState<boolean | null>(null); // null: not known yet
  const [unlockOpen, setUnlockOpen] = useState(false);
  const controller = useRef<AbortController | null>(null);

  // The cookie is httpOnly, so the page can't read it: ask the server instead.
  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((s) => setUnlocked(!!s.unlocked))
      .catch(() => setUnlocked(false));
  }, []);

  const lock = () => {
    fetch("/api/session", { method: "DELETE" }).finally(() => setUnlocked(false));
  };

  const update = (id: string, fn: (r: Run) => Run) =>
    setRuns((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));

  /** Stop whatever is running, then feed a new run from a live stream or a replay. */
  const start = useCallback(async (run: Run, events: (signal: AbortSignal) => AsyncGenerator<RagEvent>) => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setRuns((rs) => [...rs, run]);
    setSelectedId(run.id);
    try {
      for await (const e of events(ctrl.signal)) {
        if (ctrl.signal.aborted) break;
        update(run.id, (r) => applyEvent(r, e));
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        const detail = err instanceof Error ? err.message : "Stream failed";
        update(run.id, (r) => ({ ...r, error: detail }));
      }
    }
    update(run.id, (r) =>
      r.status === "running" ? { ...r, status: "done", error: r.error ?? "Stopped" } : r,
    );
  }, []);

  const stop = useCallback(() => controller.current?.abort(), []);
  useEffect(() => stop, [stop]);

  const ask = (question: string) =>
    // Only the UI's first guess: the server's first event says whether an answer follows.
    start(newRun(question, mode, "live", !!unlocked), (signal) => streamLive(question, mode, signal));

  const replay = (r: Replay) =>
    start({ ...newRun(r.question, r.mode, "replay", true), replayId: r.id }, (signal) =>
      playReplay(r, signal),
    );

  const reset = () => {
    stop();
    setRuns([]);
    setSelectedId(undefined);
  };

  const selected = runs.find((r) => r.id === selectedId) ?? runs.at(-1);
  const running = runs.some((r) => r.status === "running");
  const showTrace = (id: string) => {
    setSelectedId(id);
    setTraceOpen(true);
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar
        onReplay={replay}
        onNew={reset}
        activeReplayId={selected?.replayId}
        unlocked={unlocked}
        onUnlock={() => setUnlockOpen(true)}
        onLock={lock}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-13 shrink-0 items-center gap-2 border-b border-border px-4 lg:border-transparent">
          <span className="flex items-center gap-2 lg:hidden">
            <LogoMark className="size-5" />
            <span className="font-medium tracking-tight">Godot Docs RAG</span>
          </span>
          <span className="hidden truncate text-muted lg:block">{selected?.question ?? ""}</span>
          <div className="ml-auto flex items-center gap-1">
            {runs.length > 0 && (
              <button
                onClick={reset}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-muted hover:bg-message hover:text-foreground lg:hidden"
              >
                <Plus className="size-3.5" strokeWidth={1.75} />
                New
              </button>
            )}
            <button
              onClick={() => setTraceOpen(true)}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-muted hover:bg-message hover:text-foreground xl:hidden"
            >
              <PanelRight className="size-3.5" strokeWidth={1.75} />
              Pipeline
            </button>
          </div>
        </div>

        {runs.length === 0 ? (
          <EmptyState onReplay={replay} />
        ) : (
          <Thread
            runs={runs}
            selectedId={selected?.id}
            hovered={hovered}
            onHover={setHovered}
            onShowTrace={showTrace}
            onUnlock={() => setUnlockOpen(true)}
          />
        )}

        <Composer
          mode={mode}
          onModeChange={setMode}
          onSubmit={ask}
          onStop={stop}
          running={running}
          unlocked={unlocked}
          onUnlock={() => setUnlockOpen(true)}
          onLock={lock}
        />
      </main>

      <TracePanel run={selected} hovered={hovered} onHover={setHovered} className="hidden xl:flex" />

      <UnlockDialog
        open={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        onUnlocked={() => setUnlocked(true)}
      />

      {traceOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/60 xl:hidden" onClick={() => setTraceOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="flex h-full max-w-full">
            <TracePanel
              run={selected}
              hovered={hovered}
              onHover={setHovered}
              onClose={() => setTraceOpen(false)}
              className="flex max-w-[100vw]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
