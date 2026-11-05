"""Indexing/sync tests with a fake Pinecone and a fake embedder: no API keys, no cost."""

from types import SimpleNamespace

from rag.indexing import index_documents
from rag.models import Document, Section
from rag.retrieval import vector_search


class FakeIndex:
    def __init__(self):
        self.records: dict[str, dict] = {}

    def upsert(self, vectors, **_):
        for r in vectors:
            self.records[r["id"]] = r

    def delete(self, ids):
        for i in ids:
            self.records.pop(i, None)

    def query(self, vector, top_k, include_metadata):
        # Brute-force dot product: what Pinecone does, minus the clever index.
        scored = sorted(
            self.records.values(),
            key=lambda r: -sum(a * b for a, b in zip(vector, r["values"], strict=True)),
        )[:top_k]
        return SimpleNamespace(
            matches=[
                SimpleNamespace(
                    id=r["id"],
                    score=sum(a * b for a, b in zip(vector, r["values"], strict=True)),
                    metadata=r["metadata"],
                )
                for r in scored
            ]
        )


class FakeEmbedder:
    def __init__(self):
        self.calls = 0

    def __call__(self, texts):
        self.calls += 1
        return [[float("signal" in t), float("physics" in t)] for t in texts]


def doc(path: str, n_sections: int, word: str = "signal", version: str = "v1") -> Document:
    body = " ".join(f"This {word} sentence {i} is long enough to matter." for i in range(30))
    return Document(
        source="godot-docs",
        path=path,
        url=f"https://docs.example.org/{path}",
        title=path,
        sections=[Section(heading_path=[path, f"Part {i}"], text=body) for i in range(n_sections)],
        content_hash=f"{path}-{n_sections}-{version}",
    )


def run(docs, index, manifest, embed=None, **kw):
    return index_documents(docs, index, embed or FakeEmbedder(), manifest, **kw)


def test_first_run_indexes_every_page():
    index, manifest = FakeIndex(), {}
    stats = run([doc("a.rst", 2), doc("b.rst", 3)], index, manifest)
    assert stats["pages_indexed"] == 2
    assert set(index.records) == {"a.rst#0", "a.rst#1", "b.rst#0", "b.rst#1", "b.rst#2"}
    assert manifest["b.rst"] == {"content_hash": "b.rst-3-v1", "chunk_count": 3}
    meta = index.records["a.rst#0"]["metadata"]
    assert meta["url"] == "https://docs.example.org/a.rst"
    assert meta["text"].startswith("a.rst > Part 0")


def test_unchanged_pages_are_skipped_without_embedding():
    index, manifest = FakeIndex(), {}
    docs = [doc("a.rst", 2), doc("b.rst", 3)]
    run(docs, index, manifest)
    embed = FakeEmbedder()
    stats = run(docs, index, manifest, embed)
    assert stats["pages_skipped"] == 2 and stats["pages_indexed"] == 0
    assert embed.calls == 0  # no cost for unchanged pages


def test_shrunk_page_loses_its_leftover_chunks():
    index, manifest = FakeIndex(), {}
    run([doc("a.rst", 4)], index, manifest)
    run([doc("a.rst", 2, version="v2")], index, manifest)
    assert set(index.records) == {"a.rst#0", "a.rst#1"}  # a.rst#2 and #3 are gone
    assert manifest["a.rst"]["chunk_count"] == 2


def test_removed_page_is_deleted_from_index_and_manifest():
    index, manifest = FakeIndex(), {}
    run([doc("a.rst", 2), doc("b.rst", 2)], index, manifest)
    stats = run([doc("a.rst", 2)], index, manifest)
    assert stats["pages_deleted"] == 1
    assert not any(i.startswith("b.rst") for i in index.records)
    assert "b.rst" not in manifest


def test_limit_and_force():
    index, manifest = FakeIndex(), {}
    docs = [doc(f"{i}.rst", 1) for i in range(5)]
    assert run(docs, index, manifest, limit=2)["pages_indexed"] == 2
    assert run(docs, index, manifest)["pages_indexed"] == 3  # the rest
    assert run(docs, index, manifest, force=True)["pages_indexed"] == 5


def test_vector_search_returns_closest_chunks_best_first():
    index, manifest = FakeIndex(), {}
    run([doc("signals.rst", 1), doc("physics.rst", 1, word="physics")], index, manifest)
    results = vector_search("how do signals work", top_k=2, index=index, embed=lambda q: [1.0, 0.0])
    assert [r.path for r in results] == ["signals.rst", "physics.rst"]
    assert results[0].score > results[1].score
    assert results[0].url == "https://docs.example.org/signals.rst"
