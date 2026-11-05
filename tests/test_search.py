import pytest

from rag import retrieval
from rag.keyword import KeywordIndex, tokenize
from rag.models import RetrievedChunk
from rag.retrieval import rrf


def chunk(id: str, text: str = "") -> RetrievedChunk:
    return RetrievedChunk(
        id=id, path=id.split("#")[0], text=text, heading_path="", title="", url="", score=0.0
    )


def test_tokenize_keeps_identifiers_and_their_parts():
    assert tokenize("Call move_and_slide()!") == ["call", "move_and_slide", "move", "and", "slide"]
    assert tokenize("CharacterBody2D") == ["characterbody2d"]


def test_bm25_finds_exact_identifier():
    index = KeywordIndex(
        [
            chunk("a#0", "get_node returns the node at the given path"),
            chunk("b#0", "get_node_or_null returns null instead of failing"),
            chunk("c#0", "signals connect nodes together"),
        ]
    )
    assert index.search("what does get_node_or_null return?", top_k=1)[0].id == "b#0"


def test_bm25_rare_words_count_more_than_common_ones():
    index = KeywordIndex(
        [chunk(f"common#{i}", "the node the scene the tree") for i in range(10)]
        + [chunk("rare#0", "the tween animates a property")]
    )
    # "the" is everywhere (low IDF), "tween" is in one chunk (high IDF).
    assert index.search("the tween", top_k=1)[0].id == "rare#0"


def test_bm25_shorter_chunk_wins_on_equal_matches():
    index = KeywordIndex(
        [
            chunk("long#0", "tween " + "filler words here " * 50),
            chunk("short#0", "tween animates things"),
        ]
    )
    assert index.search("tween", top_k=1)[0].id == "short#0"


def test_bm25_ignores_chunks_without_query_words():
    index = KeywordIndex([chunk("a#0", "signals"), chunk("b#0", "physics")])
    assert [c.id for c in index.search("signals")] == ["a#0"]


def test_rrf_rewards_chunks_found_by_both_lists():
    vector = [chunk("x#0"), chunk("both#0"), chunk("y#0")]
    keyword = [chunk("z#0"), chunk("both#0"), chunk("w#0")]
    fused = rrf([vector, keyword])
    assert fused[0].id == "both#0"  # 2nd in each list beats 1st in only one
    assert fused[0].score == 2 / (60 + 2)
    assert len(fused) == 5  # duplicates merged


def test_rrf_uses_ranks_not_raw_scores():
    # Wildly different score scales don't matter; only positions do.
    vector = [chunk("a#0").model_copy(update={"score": 0.61})]
    keyword = [chunk("b#0").model_copy(update={"score": 42.0})]
    fused = rrf([vector, keyword])
    assert fused[0].score == fused[1].score == 1 / 61


def test_hybrid_fetches_at_least_top_k_candidates(monkeypatch):
    seen = {}

    def fake(name):
        def search(question, top_k):
            seen[name] = top_k
            return [chunk(f"{name}{i}#0") for i in range(top_k)]

        return search

    monkeypatch.setattr(retrieval, "vector_search", fake("v"))
    monkeypatch.setattr(retrieval, "keyword_search", fake("k"))
    assert len(retrieval.hybrid_search("q", top_k=30, candidates=20)) == 30
    assert seen == {"v": 30, "k": 30}


def test_unknown_search_mode_raises():
    with pytest.raises(ValueError, match="unknown search mode"):
        retrieval.search("q", mode="fuzzy")


def fake_lists(monkeypatch):
    """Vector finds a, b, c; keyword finds c, d, a. Records the pool size asked for."""
    seen = {}

    def fake(name, ids):
        def search(question, top_k):
            seen[name] = top_k
            return [chunk(f"{i}#0") for i in ids][:top_k]

        return search

    monkeypatch.setattr(retrieval, "vector_search", fake("vector", "abc"))
    monkeypatch.setattr(retrieval, "keyword_search", fake("keyword", "cda"))
    return seen


def test_hybrid_stages_show_each_list_then_fusion_then_context(monkeypatch):
    fake_lists(monkeypatch)
    stages = list(retrieval.search_stages("q", top_k=2, mode="hybrid"))
    assert [s.name for s in stages] == ["vector", "keyword", "fusion", "context"]
    assert [c.id for c in stages[2].chunks] == ["a#0", "c#0", "b#0", "d#0"]
    assert [c.id for c in stages[3].chunks] == ["a#0", "c#0"]
    assert all(s.ms >= 0 for s in stages)


def test_last_stage_is_exactly_what_search_returns(monkeypatch):
    fake_lists(monkeypatch)
    for mode in retrieval.SEARCH_MODES:
        *_, last = retrieval.search_stages("q", top_k=2, mode=mode)
        assert last.chunks == retrieval.search("q", top_k=2, mode=mode)


def test_single_mode_stages_skip_the_other_list_and_fusion(monkeypatch):
    seen = fake_lists(monkeypatch)
    stages = list(retrieval.search_stages("q", top_k=2, mode="keyword"))
    assert [s.name for s in stages] == ["keyword", "context"]
    assert seen == {"keyword": 2}  # no candidate pool outside hybrid
