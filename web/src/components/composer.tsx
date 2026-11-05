"use client";

import { ArrowUp, Square } from "lucide-react";
import { useState } from "react";
import { MODES, type Mode } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Composer({
  mode,
  onModeChange,
  onSubmit,
  onStop,
  running,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  onSubmit: (question: string) => void;
  onStop: () => void;
  running: boolean;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    const q = text.trim();
    if (!q || running) return;
    onSubmit(q);
    setText("");
  };

  return (
    <div className="mx-auto w-full max-w-[46rem] px-4 pb-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="rounded-2xl border border-input bg-surface/60 focus-within:border-border-strong"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          maxLength={1000}
          aria-label="Question"
          placeholder="Ask anything about Godot, e.g. how do I make a camera follow the player?"
          className="block w-full resize-none bg-transparent px-4 pt-3 outline-none placeholder:text-faint"
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex rounded-lg border border-border p-0.5" role="radiogroup" aria-label="Search mode">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => onModeChange(m)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] capitalize text-muted transition-colors hover:text-foreground",
                  mode === m && "bg-message text-foreground",
                )}
              >
                {m}
              </button>
            ))}
          </div>
          {running ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              className="grid size-7 place-items-center rounded-lg bg-foreground text-background"
            >
              <Square className="size-3" fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Ask"
              disabled={!text.trim()}
              className="grid size-7 place-items-center rounded-lg bg-foreground text-background transition-opacity disabled:opacity-30"
            >
              <ArrowUp className="size-4" strokeWidth={2} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
