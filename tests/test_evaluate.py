from types import SimpleNamespace

from rag.evaluate import evaluate, first_hit_rank, summarize


def test_first_hit_rank():
    assert first_hit_rank(["a", "b", "c"], ["c"]) == 3
    assert first_hit_rank(["a", "b"], ["x", "b"]) == 2
    assert first_hit_rank(["a", "b"], ["x"]) is None


def test_hit_rate_and_mrr():
    # Ranks 1, 2, missing, 5 with k=5 -> hits 3/4; MRR = (1 + 0.5 + 0 + 0.2) / 4
    s = summarize([1, 2, None, 5], k=5)
    assert s == {"n": 4, "hit_rate": 0.75, "mrr": 0.425}


def test_rank_beyond_k_counts_as_a_miss():
    assert summarize([6], k=5) == {"n": 1, "hit_rate": 0.0, "mrr": 0.0}


def test_evaluate_skips_unanswerable_and_splits_by_kind():
    questions = [
        {"id": "1", "kind": "exact", "question": "q1", "expected_paths": ["a"]},
        {"id": "2", "kind": "paraphrase", "question": "q2", "expected_paths": ["z"]},
        {"id": "3", "kind": "unanswerable", "question": "q3", "expected_paths": []},
    ]

    def fake_search(q, k):
        return [SimpleNamespace(path=p) for p in ["a", "b"]]

    r = evaluate(questions, fake_search, k=5)
    assert r["overall"]["n"] == 2
    assert r["by_kind"]["exact"]["hit_rate"] == 1.0
    assert r["by_kind"]["paraphrase"]["hit_rate"] == 0.0
    assert "unanswerable" not in r["by_kind"]
