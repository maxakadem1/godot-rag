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
