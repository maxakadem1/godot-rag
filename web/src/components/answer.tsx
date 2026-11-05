"use client";

import { Check, Copy } from "lucide-react";
import { isValidElement, useState, type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export type CiteRef = { runId: string; n: number } | null;

/**
 * Turn [n] citations into links to "#cite-n" so the markdown renderer hands them to
 * <Cite>. Code is left alone: `arr[1]` in a code sample is not a citation.
 */
export function linkCitations(md: string) {
  return md
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .split(/(`[^`\n]*`)/g)
            .map((p, j) => (j % 2 ? p : p.replace(/\[(\d+)\]/g, "[$1](#cite-$1)")))
            .join(""),
    )
    .join("");
}

export function Answer({
  text,
  runId,
  nChunks,
  hovered,
  onHover,
  onCiteClick,
  streaming,
}: {
  text: string;
  runId: string;
  nChunks: number;
  hovered: CiteRef;
  onHover: (c: CiteRef) => void;
  onCiteClick: () => void;
  streaming: boolean;
}) {
  return (
    <div className={cn("md", streaming && "after:ml-0.5 after:inline-block after:h-3.5 after:w-1.5 after:translate-y-0.5 after:animate-pulse after:bg-muted")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const m = href?.match(/^#cite-(\d+)$/);
            if (!m)
              return (
                <a href={href} target="_blank" rel="noreferrer" className="ext">
                  {children}
                </a>
              );
            const n = Number(m[1]);
            return (
              <Cite
                n={n}
                valid={n >= 1 && n <= nChunks}
                active={hovered?.runId === runId && hovered.n === n}
                onHover={(on) => onHover(on ? { runId, n } : null)}
                onClick={onCiteClick}
              />
            );
          },
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {linkCitations(text)}
      </ReactMarkdown>
    </div>
  );
}

function Cite({
  n,
  valid,
  active,
  onHover,
  onClick,
}: {
  n: number;
  valid: boolean;
  active: boolean;
  onHover: (on: boolean) => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={valid ? `Excerpt ${n}: hover to see it in the trace` : "This number matches no excerpt"}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onClick={onClick}
      className={cn(
        "mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded px-1 align-middle font-mono text-[10px] leading-none transition-colors",
        valid ? "bg-primary/15 text-primary hover:bg-primary/25" : "bg-danger/15 text-danger",
        active && "bg-primary text-white",
      )}
    >
      {n}
    </button>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = isValidElement(children)
    ? (children as ReactElement<{ className?: string; children?: ReactNode }>)
    : null;
  const lang = code?.props.className?.replace("language-", "") ?? "code";
  const text = String(code?.props.children ?? "");
  return (
    <div className="overflow-hidden rounded-lg border border-border-strong bg-surface/50">
      <div className="flex items-center justify-between border-b border-border px-3 py-1 text-[11px] text-faint">
        <span className="font-mono">{lang}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(text.replace(/\n$/, ""));
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="flex items-center gap-1 hover:text-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12px] leading-relaxed">{children}</pre>
    </div>
  );
}
