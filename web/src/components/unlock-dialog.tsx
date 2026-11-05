"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** Native <dialog>: focus trapping, Esc to close and the backdrop come for free. */
export function UnlockDialog({
  open,
  onClose,
  onUnlocked,
}: {
  open: boolean;
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword("");
        onUnlocked();
        onClose();
      } else {
        setError((await res.json().catch(() => null))?.detail ?? `Failed (${res.status})`);
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-border-strong bg-surface p-0 text-foreground shadow-[0_24px_72px_-20px_rgb(0_0_0/0.9)] backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={submit} className="p-5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-message">
            <KeyRound className="size-4" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="font-medium">Unlock live answers</h2>
            <p className="text-[12px] text-muted">Retrieval is free for everyone. Answers need the password.</p>
          </div>
        </div>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
          aria-invalid={!!error}
          placeholder="Password"
          className="mt-4 w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:border-border-strong"
        />
        {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-muted hover:bg-message hover:text-foreground">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!password || busy}
            className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 font-medium text-background disabled:opacity-40"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Unlock
          </button>
        </div>
      </form>
    </dialog>
  );
}
