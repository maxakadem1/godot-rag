import { cn } from "@/lib/utils";
import type { Outcome } from "@/lib/replays";

export function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-px text-[11px] leading-4 text-muted",
        className,
      )}
      {...props}
    />
  );
}

const OUTCOME_COLOR: Record<Outcome, string> = {
  answered: "bg-fusion",
  missed: "bg-keyword",
  refused: "bg-muted",
};

export function OutcomeDot({ outcome, className }: { outcome: Outcome; className?: string }) {
  return (
    <span
      title={outcome}
      className={cn("inline-block size-1.5 shrink-0 rounded-full", OUTCOME_COLOR[outcome], className)}
    />
  );
}

/**
 * "Title > Section > Sub" shown as a quiet breadcrumb. `compact` puts the most
 * specific heading first, for narrow rows where the shared page title would push
 * the part that tells chunks apart out of view.
 */
export function HeadingPath({
  path,
  className,
  compact,
}: {
  path: string;
  className?: string;
  compact?: boolean;
}) {
  const parts = path.split(" > ");
  if (compact)
    return (
      <span className={cn("truncate", className)} title={path}>
        <span className="text-foreground">{parts.at(-1)}</span>
        {parts.length > 1 && <span className="text-faint"> · {parts[0]}</span>}
      </span>
    );
  return (
    <span className={cn("truncate", className)} title={path}>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="px-1 text-faint">›</span>}
          <span className={i === parts.length - 1 ? "text-foreground" : "text-muted"}>{p}</span>
        </span>
      ))}
    </span>
  );
}
