"""Convert a Godot docs reStructuredText page into clean text split by headings.

Deliberately plain code, not an LLM: it's free, fast, deterministic and doesn't
drop or invent content. (See docs/05-decisions.md.)

It is not a full RST parser. It handles what the Godot docs actually use:
headings, Sphinx directives (notes, code blocks, tabs, images, toctrees...),
roles like :ref:`text <target>` and inline markup. Known gaps are listed in
docs/04-roadmap.md.
"""

import hashlib
import re

from rag.models import Document, Section

# Directives whose body is kept, labelled (e.g. "Note: ...").
ADMONITIONS = {
    "note",
    "warning",
    "tip",
    "important",
    "seealso",
    "caution",
    "danger",
    "attention",
    "hint",
    "error",
    "admonition",
}
# Directives whose body is code and kept verbatim in a fenced block.
CODE_DIRECTIVES = {"code-block", "code", "code-tab", "sourcecode"}
# Directives that just wrap other content: drop the directive, keep the body.
CONTAINERS = {"tabs", "tab", "group-tab", "only", "container", "rubric"}
# Everything else (image, figure, toctree, raw, video, rst-class, meta, ...) is dropped.

DIRECTIVE_RE = re.compile(r"^(\s*)\.\.\s+([\w:-]+)::\s*(.*)$")
COMMENT_RE = re.compile(r"^(\s*)\.\.(\s|$)")  # labels, comments, substitution definitions
OPTION_RE = re.compile(r"^\s*:[\w -]+:")
ADORNMENT_RE = re.compile(r"^([=\-~`:'\"^_*+#.<>])\1{2,}\s*$")


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _take_block(lines: list[str], start: int, parent_indent: int) -> tuple[list[str], int]:
    """Collect the indented body that follows a directive. Returns (body, next_index)."""
    body = []
    i = start
    while i < len(lines):
        line = lines[i]
        if line.strip() and _indent(line) <= parent_indent:
            break
        body.append(line)
        i += 1
    while body and not body[-1].strip():
        body.pop()
    return body, i


def _dedent(lines: list[str]) -> list[str]:
    indents = [_indent(line) for line in lines if line.strip()]
    if not indents:
        return []
    n = min(indents)
    return [line[n:] if line.strip() else "" for line in lines]


def _strip_options(body: list[str]) -> list[str]:
    """Drop directive option lines (':alt: ...', ':linenos:') at the top of a body."""
    i = 0
    while i < len(body) and (OPTION_RE.match(body[i]) or not body[i].strip()):
        i += 1
    return body[i:]


def expand_directives(lines: list[str]) -> list[str]:
    """Replace Sphinx directives with plain text (or remove them)."""
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = DIRECTIVE_RE.match(line)
        if m:
            indent, name, arg = len(m.group(1)), m.group(2).lower(), m.group(3).strip()
            body, i = _take_block(lines, i + 1, indent)
            body = _dedent(_strip_options(body))
            if name in ADMONITIONS:
                if name == "admonition":
                    label = arg or "Note"
                else:
                    label = name.capitalize()
                    if arg:  # one-line form: `.. note:: Text on the same line`
                        body = [arg, *body]
                inner = expand_directives(body)
                if inner:
                    out.append(f"{label}: {inner[0]}")
                    out.extend(inner[1:])
                out.append("")
            elif name in CODE_DIRECTIVES:
                out.append(f"```{arg.split()[0] if arg else ''}")
                out.extend(body)
                out.append("```")
                out.append("")
            elif name in CONTAINERS:
                out.extend(expand_directives(body))
                out.append("")
            continue
        if COMMENT_RE.match(line):
            _, i = _take_block(lines, i + 1, _indent(line))
            continue
        out.append(line)
        i += 1
    return out


def _label_to_words(m: re.Match) -> str:
    """Bare reference labels: class_Node -> Node, doc_first_script -> first script."""
    target = m.group(1)
    if target.startswith("class_"):
        return target.removeprefix("class_")
    if target.startswith("doc_"):
        return target.removeprefix("doc_").replace("_", " ")
    return target


def clean_inline(text: str) -> str:
    """Strip inline RST markup, keeping the readable text. Works across line breaks."""
    # :role:`Text <target>` -> Text ;  :role:`target` -> target
    text = re.sub(r":[\w:-]+:`([^`<]*?)\s*<[^`>]*>`", r"\1", text)
    text = re.sub(r":[\w:-]+:`~?([^`]*)`", _label_to_words, text)
    # `Link text <https://...>`_  /  `Link text`_  ->  Link text
    text = re.sub(r"`([^`<]*?)\s*<[^`>]*>`__?", r"\1", text)
    text = re.sub(r"`([^`]+)`__?", r"\1", text)
    # ``code`` -> `code`
    text = re.sub(r"``([^`]+)``", r"`\1`", text)
    # **bold** / *italic* -> plain
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"(?<![\w*])\*([^*\s][^*\n]*)\*(?![\w*])", r"\1", text)
    # |substitutions| -> removed
    text = re.sub(r"\|[\w-]+\|", "", text)
    # "Example::" introduces a literal block -> "Example:"
    text = re.sub(r"(\S)::[ \t]*$", r"\1:", text, flags=re.MULTILINE)
    text = re.sub(r"^::[ \t]*$", "", text, flags=re.MULTILINE)
    # Page metadata fields at column 0, e.g. ":github_url: hide"
    text = re.sub(r"^:[\w-]+:(?!`).*$", "", text, flags=re.MULTILINE)
    # Backslash escapes used in the class reference: "method\ (\ x\: int\ )" -> "method(x: int)"
    text = text.replace("\\ ", "")
    text = re.sub(r"\\(.)", r"\1", text)
    # Permalink icons and horizontal rules
    text = text.replace("🔗", "")
    text = re.sub(r"^-{4,}[ \t]*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"[ \t]+$", "", text, flags=re.MULTILINE)
    return text


def clean_text(text: str) -> str:
    """clean_inline() on prose only; fenced code blocks are left untouched."""
    parts = re.split(r"(```.*?\n```)", text, flags=re.DOTALL)
    return "".join(p if p.startswith("```") else clean_inline(p) for p in parts)


def split_sections(lines: list[str]) -> tuple[str | None, list[Section]]:
    """Split lines into sections by heading. Returns (page_title, sections)."""
    styles: list[tuple[str, bool]] = []  # heading styles in order of first use = level
    path: list[str] = []
    title: str | None = None
    sections: list[Section] = []
    buf: list[str] = []
    in_code = False

    def flush() -> None:
        text = clean_text("\n".join(buf)).strip()
        text = re.sub(r"\n{3,}", "\n\n", text)
        if text:
            sections.append(Section(heading_path=list(path), text=text))
        buf.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            in_code = not in_code
            buf.append(line)
            i += 1
            continue
        if in_code:
            buf.append(line)
            i += 1
            continue

        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        has_overline = (
            bool(ADORNMENT_RE.match(line))
            and i + 2 < len(lines)
            and bool(ADORNMENT_RE.match(lines[i + 2]))
            and lines[i + 1].strip() != ""
        )
        is_heading = (
            line.strip()
            and not line.startswith(" ")
            and not ADORNMENT_RE.match(line)
            and ADORNMENT_RE.match(nxt)
            and len(nxt.rstrip()) >= len(line.rstrip())
        )

        if has_overline or is_heading:
            text_line = lines[i + 1] if has_overline else line
            style = ((lines[i + 2] if has_overline else nxt).strip()[0], has_overline)
            if style not in styles:
                styles.append(style)
            level = styles.index(style)
            heading = clean_inline(text_line.strip())
            flush()
            if title is None:
                title = heading
            path[:] = path[:level] + [heading]
            i += 3 if has_overline else 2
            continue

        buf.append(line)
        i += 1

    flush()
    return title, sections


def page_url(base_url: str, rel_path: str) -> str:
    return f"{base_url.rstrip('/')}/{rel_path.removesuffix('.rst')}.html"


def parse_rst(source: str, rel_path: str, raw: str, base_url: str) -> Document | None:
    """Parse one page. Returns None if the page has no real content (e.g. a toctree-only index)."""
    lines = raw.replace("\r\n", "\n").replace("\t", "    ").split("\n")
    title, sections = split_sections(expand_directives(lines))
    if not sections:
        return None
    full_text = "\n\n".join(s.text for s in sections)
    return Document(
        source=source,
        path=rel_path,
        url=page_url(base_url, rel_path),
        title=title or rel_path.rsplit("/", 1)[-1].removesuffix(".rst"),
        sections=sections,
        content_hash=hashlib.sha256(full_text.encode()).hexdigest(),
    )
