"""Retrieval: vector search, BM25 keyword search, and hybrid fusion with RRF."""

import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal, get_args

from rag.models import RetrievedChunk

SearchMode = Literal["hybrid", "vector", "keyword"]
SEARCH_MODES: tuple[str, ...] = get_args(SearchMode)


def vector_search(question: str, top_k: int = 5, index=None, embed=None) -> list[RetrievedChunk]:
    """Embed the question and return the top_k nearest chunks from Pinecone (cosine).

    `index` and `embed` default to the real Pinecone index and OpenAI embedder; tests
    pass fakes.
    """
    if index is None:
        from rag.store import get_index

        index = get_index()
    if embed is None:
        from rag.embeddings import embed_query

        embed = embed_query

    response = index.query(vector=embed(question), top_k=top_k, include_metadata=True)
    return [
        RetrievedChunk(
            id=m.id,
            path=m.metadata["path"],
            text=m.metadata["text"],
            heading_path=m.metadata["heading_path"],
            title=m.metadata["title"],
            url=m.metadata["url"],
            score=m.score,
        )
        for m in response.matches
    ]


def keyword_search(question: str, top_k: int = 5) -> list[RetrievedChunk]:
    from rag.keyword import keyword_search as bm25_search

    return bm25_search(question, top_k)


def rrf(result_lists: list[list[RetrievedChunk]], k: int = 60) -> list[RetrievedChunk]:
    """Reciprocal Rank Fusion: score(chunk) = sum over lists of 1 / (k + rank).

    Uses ranks only, because cosine similarity and BM25 scores are on unrelated scales.
    A chunk ranked well by both lists outscores one ranked first by only one of them.
    k=60 follows Cormack et al. (2009).
    """
    scores: dict[str, float] = {}
    chunks: dict[str, RetrievedChunk] = {}
    for results in result_lists:
        for rank, chunk in enumerate(results, start=1):
            scores[chunk.id] = scores.get(chunk.id, 0.0) + 1 / (k + rank)
            chunks.setdefault(chunk.id, chunk)
    ranked = sorted(scores, key=scores.__getitem__, reverse=True)
    return [chunks[i].model_copy(update={"score": scores[i]}) for i in ranked]


def hybrid_search(question: str, top_k: int = 5, candidates: int = 20) -> list[RetrievedChunk]:
    """Top `candidates` from vector and keyword search, fused with RRF, cut to top_k."""
    return search(question, top_k, "hybrid", candidates)


@dataclass
class Stage:
    """One step of a search, for showing the pipeline as it runs.

    name: "vector" / "keyword" (that search's candidate list, best first),
    "fusion" (every candidate re-ranked by RRF score) or "context" (the final top_k,
    always last). ms is how long the step took.
    """

    name: Literal["vector", "keyword", "fusion", "context"]
    ms: float
    chunks: list[RetrievedChunk]


def search_stages(
    question: str, top_k: int = 5, mode: SearchMode = "hybrid", candidates: int = 20
) -> Iterator[Stage]:
    """Run a search one stage at a time. The last stage holds the same chunks search()
    returns, because search() is built on this: the trace shows exactly what was used.

    Hybrid search pulls `candidates` from each list (more than top_k) so a chunk ranked
    6th by both lists can still win the fusion.
    """
    if mode not in SEARCH_MODES:
        raise ValueError(f"unknown search mode {mode!r}; expected one of {SEARCH_MODES}")
    pool = max(candidates, top_k) if mode == "hybrid" else top_k

    lists = []
    for name, run in (("vector", vector_search), ("keyword", keyword_search)):
        if mode in (name, "hybrid"):
            start = time.perf_counter()
            results = run(question, pool)
            lists.append(results)
            yield Stage(name, _ms_since(start), results)

    if mode == "hybrid":
        start = time.perf_counter()
        fused = rrf(lists)
        yield Stage("fusion", _ms_since(start), fused)
        lists = [fused]
    yield Stage("context", 0.0, lists[0][:top_k])


def search(
    question: str, top_k: int = 5, mode: SearchMode = "hybrid", candidates: int = 20
) -> list[RetrievedChunk]:
    *_, last = search_stages(question, top_k, mode, candidates)
    return last.chunks


def _ms_since(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 1)
