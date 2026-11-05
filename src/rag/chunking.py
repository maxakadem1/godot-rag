"""Heading-aware chunking with token limits.

Per document:

1. Start from the sections the parser produced. Headings are the author's own topic
   boundaries, so a chunk never mixes two unrelated topics by accident.
2. Merge tiny sections (a heading with one sentence) into the section after them,
   so we don't embed 20-token fragments that carry almost no meaning.
3. Split sections that are too long. Split at paragraph and code-block boundaries
   first, and only cut inside a block if that one block is bigger than the limit.
4. Consecutive pieces of one split section share ~overlap_tokens of text, so an idea
   cut at a boundary still appears whole in at least one chunk.
5. Every chunk starts with its title + heading path ("Using signals > Connecting a
   signal in code"), so the embedding knows what the chunk is about even when the
   text alone ("Call it every frame.") doesn't say.

Every limit is measured in tokens (tiktoken), not characters, because tokens are what
the embedding model and the LLM actually count.
"""

import hashlib
import re
from dataclasses import dataclass
from itertools import pairwise

import tiktoken

from rag.models import Chunk, Document

# text-embedding-3-small's tokenizer, so counts match its input limit and billing.
_ENCODING = tiktoken.get_encoding("cl100k_base")

# A fenced code block, kept whole when possible. Blank lines inside code don't split it.
_CODE_BLOCK_RE = re.compile(r"```.*?\n```", re.DOTALL)


def count_tokens(text: str) -> int:
    return len(_ENCODING.encode(text))


@dataclass
class _Unit:
    """A heading path and the text under it: a section, or several merged sections."""

    path: list[str]
    body: str


def chunk_document(
    doc: Document,
    max_tokens: int = 500,
    overlap_tokens: int = 50,
    min_tokens: int = 100,
) -> list[Chunk]:
    """Split one document into chunks of at most max_tokens (prefix included)."""
    units = [_Unit(s.heading_path or [doc.title], s.text) for s in doc.sections if s.text.strip()]
    units = _merge_tiny(units, doc.title, max_tokens, min_tokens)

    chunks: list[Chunk] = []
    for unit in units:
        prefix = _prefix(doc.title, unit.path)
        # The prefix counts against the limit, because it is part of what gets embedded.
        body_budget = max(max_tokens - count_tokens(prefix + "\n\n"), 50)
        for body in _split_long(unit.body, body_budget, overlap_tokens):
            text = f"{prefix}\n\n{body}"
            chunks.append(
                Chunk(
                    document_path=doc.path,
                    chunk_index=len(chunks),
                    heading_path=prefix,
                    text=text,
                    token_count=count_tokens(text),
                    content_hash=hashlib.sha256(text.encode()).hexdigest(),
                )
            )
    return chunks


def _prefix(title: str, path: list[str]) -> str:
    """'Title > Heading > Subheading'. The first heading is usually the title already."""
    parts = path if path and path[0] == title else [title, *path]
    return " > ".join(parts)


def _merge_tiny(units: list[_Unit], title: str, max_tokens: int, min_tokens: int) -> list[_Unit]:
    """Merge sections shorter than min_tokens into the next section, while it fits."""
    merged: list[_Unit] = []
    for unit in units:
        if merged and count_tokens(merged[-1].body) < min_tokens:
            combined = _combine(merged[-1], unit)
            if count_tokens(_prefix(title, combined.path) + "\n\n" + combined.body) <= max_tokens:
                merged[-1] = combined
                continue
        merged.append(unit)

    # A tiny last section has no "next" to join, so it goes into the one before it.
    if len(merged) > 1 and count_tokens(merged[-1].body) < min_tokens:
        combined = _combine(merged[-2], merged[-1])
        if count_tokens(_prefix(title, combined.path) + "\n\n" + combined.body) <= max_tokens:
            merged[-2:] = [combined]
    return merged


def _combine(a: _Unit, b: _Unit) -> _Unit:
    """Join two neighbouring sections under the heading path they share.

    E.g. ["Signals", "Intro"] + ["Signals", "Setup"] -> path ["Signals"], and the
    "Setup" heading is kept as a line inside the text so nothing is lost.
    """
    common: list[str] = []
    for x, y in zip(a.path, b.path, strict=False):
        if x != y:
            break
        common.append(x)

    def labelled(unit: _Unit) -> str:
        extra = unit.path[len(common) :]
        return f"{' > '.join(extra)}\n{unit.body}" if extra else unit.body

    return _Unit(common or a.path[:1], f"{labelled(a)}\n\n{labelled(b)}")


def _split_long(body: str, budget: int, overlap: int) -> list[str]:
    """Split text into pieces of at most `budget` tokens, overlapping by ~`overlap`."""
    if count_tokens(body) <= budget:
        return [body]

    # Leave room for the overlap that gets prepended to every piece after the first.
    fill = budget - overlap
    blocks = [b for block in _blocks(body) for b in _hard_split(block, fill)]

    pieces: list[list[str]] = [[]]
    size = 0
    for block in blocks:
        block_tokens = count_tokens(block) + 1  # +1 for the "\n\n" joining blocks
        if pieces[-1] and size + block_tokens > fill:
            pieces.append([])
            size = 0
        pieces[-1].append(block)
        size += block_tokens

    texts = ["\n\n".join(p) for p in pieces]
    out = [texts[0]]
    for prev, cur in pairwise(texts):
        out.append(_with_overlap(prev, cur, overlap, budget))
    return out


def _with_overlap(prev: str, cur: str, overlap: int, budget: int) -> str:
    """Prepend the end of `prev` to `cur`, shrinking the overlap until it fits the budget.

    Token counts aren't additive: tokens(a + b) can be tokens(a) + tokens(b) + 1, because
    BPE may merge characters differently where two strings meet. The packing above uses
    the sum as an estimate, so the final text is measured exactly here.
    """
    n = overlap
    while n > 0:
        piece = f"{_tail(prev, n)}\n\n{cur}"
        if count_tokens(piece) <= budget:
            return piece
        n -= 5
    return cur


def _blocks(text: str) -> list[str]:
    """Paragraphs and whole code blocks, in order."""
    blocks: list[str] = []
    pos = 0
    for m in _CODE_BLOCK_RE.finditer(text):
        blocks += _paragraphs(text[pos : m.start()])
        blocks.append(m.group(0))
        pos = m.end()
    blocks += _paragraphs(text[pos:])
    return blocks


def _paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def _hard_split(block: str, size: int) -> list[str]:
    """Last resort for one block bigger than the budget (a huge table or code listing):
    cut it into windows of `size` tokens."""
    tokens = _ENCODING.encode(block)
    if len(tokens) <= size:
        return [block]
    return [_ENCODING.decode(tokens[i : i + size]) for i in range(0, len(tokens), size)]


def _tail(text: str, n: int) -> str:
    """The last ~n tokens of text, starting at a word boundary so we don't open mid-word."""
    tokens = _ENCODING.encode(text)
    if len(tokens) <= n:
        return text
    tail = _ENCODING.decode(tokens[-n:])
    space = tail.find(" ")
    return tail[space + 1 :] if 0 <= space < len(tail) // 2 else tail
