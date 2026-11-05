import re
from itertools import pairwise

from rag.chunking import chunk_document, count_tokens
from rag.models import Document, Section


def make_doc(*sections: tuple[list[str], str]) -> Document:
    return Document(
        source="godot-docs",
        path="tutorials/test.rst",
        url="https://docs.example.org/tutorials/test.html",
        title="Using signals",
        sections=[Section(heading_path=p, text=t) for p, t in sections],
        content_hash="x",
    )


def sentences(n: int, word: str = "signal") -> str:
    """n numbered sentences; numbering lets tests check nothing was lost or reordered."""
    return " ".join(f"Sentence {i} talks about the {word} system in detail." for i in range(n))


def paragraphs(n: int) -> str:
    return "\n\n".join(f"Paragraph {i}. {sentences(8)}" for i in range(n))


def test_small_page_is_one_chunk_with_heading_prefix():
    doc = make_doc((["Using signals"], sentences(30)))
    [chunk] = chunk_document(doc)
    assert chunk.text.startswith("Using signals\n\n")
    assert chunk.heading_path == "Using signals"
    assert chunk.document_path == "tutorials/test.rst"
    assert chunk.token_count == count_tokens(chunk.text)


def test_prefix_includes_full_heading_path():
    doc = make_doc(
        (["Using signals"], sentences(30)),
        (["Using signals", "Connecting in code"], sentences(30)),
    )
    chunks = chunk_document(doc)
    assert chunks[1].text.startswith("Using signals > Connecting in code\n\n")


def test_no_chunk_exceeds_max_tokens():
    doc = make_doc(
        (["Using signals"], paragraphs(40)),
        (["Using signals", "Huge code"], "```\n" + "x = 1\n" * 2000 + "```"),
        (["Using signals", "One giant line"], "word " * 3000),
    )
    for max_tokens in (200, 300, 500):
        chunks = chunk_document(doc, max_tokens=max_tokens)
        assert len(chunks) > 3
        assert all(c.token_count <= max_tokens for c in chunks), max_tokens


def test_nothing_is_lost_and_order_is_preserved():
    doc = make_doc((["Using signals"], paragraphs(40)))
    chunks = chunk_document(doc, max_tokens=300)
    seen = [int(n) for c in chunks for n in re.findall(r"Paragraph (\d+)\.", c.text)]
    # Overlap can repeat a paragraph marker, so dedupe in order, then compare.
    assert list(dict.fromkeys(seen)) == list(range(40))
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))


def test_consecutive_pieces_overlap():
    doc = make_doc((["Using signals"], paragraphs(40)))
    chunks = chunk_document(doc, max_tokens=300, overlap_tokens=50)
    for prev, cur in pairwise(chunks):
        cur_body = cur.text.split("\n\n", 1)[1]
        # The start of each piece is copied from the end of the previous one.
        assert cur_body[:40] in prev.text


def test_tiny_section_is_merged_into_next():
    doc = make_doc(
        (["Using signals"], "Signals are Godot's observer pattern."),
        (["Using signals", "Connecting in code"], sentences(20)),
    )
    [chunk] = chunk_document(doc)
    # Merged chunk sits under the shared heading; the sub-heading is kept in the text.
    assert chunk.heading_path == "Using signals"
    assert "observer pattern" in chunk.text
    assert "Connecting in code\nSentence 0" in chunk.text


def test_tiny_last_section_is_merged_into_previous():
    doc = make_doc(
        (["Using signals"], sentences(20)),
        (["Using signals", "See also"], "The Node class."),
    )
    [chunk] = chunk_document(doc)
    assert chunk.text.endswith("See also\nThe Node class.")


def test_big_sections_are_not_merged():
    doc = make_doc(
        (["Using signals", "A"], sentences(30)),
        (["Using signals", "B"], sentences(30)),
    )
    chunks = chunk_document(doc)
    assert [c.heading_path for c in chunks] == ["Using signals > A", "Using signals > B"]


def test_code_block_with_blank_lines_stays_together():
    code = "```\nfunc _ready():\n    pass\n\n\nfunc _process(delta):\n    pass\n```"
    doc = make_doc((["Using signals"], f"{paragraphs(10)}\n\n{code}\n\n{paragraphs(10)}"))
    chunks = chunk_document(doc, max_tokens=300)
    assert any(code in c.text for c in chunks)


def test_hash_changes_with_text():
    a = chunk_document(make_doc((["Using signals"], sentences(30))))[0]
    b = chunk_document(make_doc((["Using signals"], sentences(31))))[0]
    assert a.content_hash != b.content_hash
