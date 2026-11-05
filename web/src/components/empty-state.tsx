"use client";

import { LogoMark } from "./logo";
import { OutcomeDot } from "./ui";
import { REPLAYS, type Replay } from "@/lib/replays";

export function EmptyState({ onReplay }: { onReplay: (r: Replay) => void }) {
  return (
    // my-auto (not justify-center) centres the content but still lets it scroll from
    // the top when it is taller than the screen.
    <div className="flex flex-1 flex-col overflow-y-auto px-4 py-10">
      <div className="my-auto flex flex-col items-center">
        <LogoMark className="size-28" />
        <h1 className="mt-8 text-xl font-medium tracking-tight">
          Ask the Godot docs
        </h1>
        <p className="mt-2 max-w-md text-center text-muted">
          Hybrid retrieval over 8,580 chunks of the official documentation, with
          every step shown: what vector search found, what keyword search found,
          how the two were merged, and which chunks the answer cites.
        </p>
        <div className="mt-8 grid w-full max-w-xl gap-2 sm:grid-cols-2">
          {REPLAYS.map((r) => (
            <button
              key={r.id}
              onClick={() => onReplay(r)}
              className="rounded-xl border border-border px-3.5 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-message"
            >
              <span className="flex items-start gap-2.5">
                <OutcomeDot outcome={r.outcome} className="mt-2" />
                <span className="text-foreground">{r.question}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-faint">
          These replay real API runs at their original speed. Or type your own
          question below.
        </p>
      </div>
    </div>
  );
}
