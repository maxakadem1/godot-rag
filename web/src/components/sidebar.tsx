"use client";

import { BookOpen, FolderGit2, Lock, LockOpen, Plus } from "lucide-react";
import { LogoMark } from "./logo";
import { OutcomeDot } from "./ui";
import { REPLAYS, type Replay } from "@/lib/replays";
import { cn } from "@/lib/utils";

const item =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-muted transition-colors hover:bg-message hover:text-foreground";

export function Sidebar({
  onReplay,
  onNew,
  activeReplayId,
  unlocked,
  onUnlock,
  onLock,
}: {
  onReplay: (r: Replay) => void;
  onNew: () => void;
  activeReplayId?: string;
  unlocked: boolean | null;
  onUnlock: () => void;
  onLock: () => void;
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border lg:flex">
      <div className="flex h-13 items-center gap-2.5 px-4">
        <LogoMark className="size-5" />
        <span className="font-medium tracking-tight">Godot Docs RAG</span>
      </div>

      <div className="px-2">
        <button onClick={onNew} className={item}>
          <Plus className="size-3.5" strokeWidth={1.75} />
          New question
        </button>
      </div>

      <div className="mt-5 px-4 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">
        Recorded runs
      </div>
      <nav className="flex flex-col gap-px px-2">
        {REPLAYS.map((r) => (
          <button
            key={r.id}
            onClick={() => onReplay(r)}
            title={r.question}
            className={cn(item, activeReplayId === r.id && "bg-message text-foreground")}
          >
            <OutcomeDot outcome={r.outcome} />
            <span className="truncate">{r.label}</span>
          </button>
        ))}
      </nav>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 px-4 text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <OutcomeDot outcome="answered" />
          answered
        </span>
        <span className="flex items-center gap-1.5">
          <OutcomeDot outcome="missed" />
          missed
        </span>
        <span className="flex items-center gap-1.5">
          <OutcomeDot outcome="refused" />
          not in docs
        </span>
      </div>

      <div className="mt-auto flex flex-col gap-px border-t border-border p-2">
        {unlocked ? (
          <button onClick={onLock} className={item} title="Lock answers again">
            <LockOpen className="size-3.5 text-fusion" strokeWidth={1.75} />
            Answers unlocked
            <span className="ml-auto text-[11px] text-faint">Lock</span>
          </button>
        ) : (
          <button onClick={onUnlock} className={item}>
            <Lock className="size-3.5" strokeWidth={1.75} />
            Unlock live answers
          </button>
        )}
        <a href="https://github.com/maxakadem1/godot-rag" target="_blank" rel="noreferrer" className={item}>
          <FolderGit2 className="size-3.5" strokeWidth={1.75} />
          Source on GitHub
        </a>
        <a href="https://docs.godotengine.org/en/stable/" target="_blank" rel="noreferrer" className={item}>
          <BookOpen className="size-3.5" strokeWidth={1.75} />
          Godot documentation
        </a>
      </div>
    </aside>
  );
}
