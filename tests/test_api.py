"""API tests: request validation, error mapping and /ask wiring, with no network calls."""

import json

import pytest
from fastapi.testclient import TestClient
from openai import APIConnectionError

from rag import api, generation
from rag.limits import DailyBudget, RateLimiter
from rag.models import RetrievedChunk
from rag.retrieval import Stage

from .test_generation import FakeLLM, chunk


@pytest.fixture(autouse=True)
def fresh_limits(monkeypatch):
    """Limits are process-wide, so every test starts with its own, unlimited ones."""
    monkeypatch.setattr(api, "rate_limiter", RateLimiter(0))
    monkeypatch.setattr(api, "answer_budget", DailyBudget(0))
    monkeypatch.setattr(api.settings, "internal_api_key", "")


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(api.settings, "openai_api_key", "test")
    monkeypatch.setattr(api.settings, "pinecone_api_key", "test")
    return TestClient(api.app)


def test_ask_returns_answer_and_only_cited_sources(client, monkeypatch):
    calls = []

    def fake_search(q, k, mode):
        calls.append((q, k, mode))
        return [chunk(1), chunk(2)]

    monkeypatch.setattr(api.retrieval, "search", fake_search)
    monkeypatch.setattr(generation, "_client", lambda: FakeLLM("Signals notify nodes [2]."))

    res = client.post("/ask", json={"question": "What are signals?", "k": 3})

    assert res.status_code == 200
    assert calls == [("What are signals?", 3, "hybrid")]
    assert res.json() == {
        "answer": "Signals notify nodes [2].",
        "sources": [
            {
                "n": 2,
                "title": "Page 2",
                "url": "https://docs.example.org/page2.html",
                "heading_path": "Page 2 > Heading",
            }
        ],
    }


@pytest.mark.parametrize(
    "body",
    [
        {"question": ""},
        {"question": "x" * 1001},
        {"question": "ok", "mode": "fuzzy"},
        {"question": "ok", "k": 0},
        {"question": "ok", "k": 21},
    ],
)
def test_ask_rejects_invalid_requests(client, body):
    assert client.post("/ask", json=body).status_code == 422


@pytest.mark.parametrize("params", [{"q": "x", "mode": "fuzzy"}, {"q": "x", "k": 0}, {"q": ""}])
def test_search_rejects_invalid_params(client, params):
    assert client.get("/search", params=params).status_code == 422


def test_search_passes_params_through(client, monkeypatch):
    monkeypatch.setattr(api.retrieval, "search", lambda q, k, mode: [chunk(1)][:k])
    res = client.get("/search", params={"q": "signals", "k": 1, "mode": "keyword"})
    assert res.status_code == 200
    assert [RetrievedChunk(**c).id for c in res.json()] == ["page1.rst#0"]


def test_missing_keys_give_503_except_keyword_search(monkeypatch):
    monkeypatch.setattr(api.settings, "openai_api_key", "")
    monkeypatch.setattr(api.settings, "pinecone_api_key", "")
    monkeypatch.setattr(api.retrieval, "search", lambda q, k, mode: [])
    c = TestClient(api.app)
    assert c.get("/search", params={"q": "x", "mode": "hybrid"}).status_code == 503
    assert c.post("/ask", json={"question": "x", "mode": "keyword"}).status_code == 503
    assert c.get("/search", params={"q": "x", "mode": "keyword"}).status_code == 200


def test_upstream_failure_maps_to_502(client, monkeypatch):
    def boom(q, k, mode):
        raise APIConnectionError(request=None)

    monkeypatch.setattr(api.retrieval, "search", boom)
    res = client.post("/ask", json={"question": "x"})
    assert res.status_code == 502
    assert res.json() == {"detail": "Upstream error: APIConnectionError"}


def fake_stages(question, k, mode):
    yield Stage("vector", 12.0, [chunk(1), chunk(2)])
    yield Stage("keyword", 3.0, [chunk(2), chunk(3)])
    yield Stage("fusion", 0.1, [chunk(2), chunk(1), chunk(3)])
    yield Stage("context", 0.0, [chunk(2), chunk(1)])


def events(res) -> list[tuple[str, dict]]:
    """Parse a Server-Sent Events body into (event, data) pairs."""
    out = []
    for block in res.text.strip().split("\n\n"):
        name, data = block.split("\n")
        out.append((name.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return out


def test_stream_sends_each_stage_then_answer_and_citations(client, monkeypatch):
    monkeypatch.setattr(api.retrieval, "search_stages", fake_stages)
    monkeypatch.setattr(generation, "_client", lambda: FakeLLM("Nodes emit signals [1]."))

    res = client.post("/ask/stream", json={"question": "What are signals?"})

    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    evs = events(res)
    names = [n for n, _ in evs]
    assert names[:4] == ["vector", "keyword", "fusion", "context"]
    assert names[-2:] == ["citations", "done"]
    assert set(names[4:-2]) == {"token"}

    vector = evs[0][1]
    assert vector["ms"] == 12.0
    assert vector["hits"][0] == {
        "id": "page1.rst#0",
        "rank": 1,
        "score": 1.0,
        "title": "Page 1",
        "heading_path": "Page 1 > Heading",
        "url": "https://docs.example.org/page1.html",
    }
    assert [c["id"] for c in evs[3][1]["chunks"]] == ["page2.rst#0", "page1.rst#0"]
    assert "".join(d["text"] for n, d in evs if n == "token") == "Nodes emit signals [1]."
    assert evs[-2][1]["cited"] == [1]


def test_stream_without_generate_stops_after_retrieval(client, monkeypatch):
    monkeypatch.setattr(api.retrieval, "search_stages", fake_stages)
    llm = FakeLLM("unused")
    monkeypatch.setattr(generation, "_client", lambda: llm)

    res = client.post("/ask/stream", json={"question": "q", "generate": False})

    assert [n for n, _ in events(res)] == ["vector", "keyword", "fusion", "context", "done"]
    assert llm.messages is None


def test_stream_without_generate_needs_no_openai_key_for_keyword_mode(monkeypatch):
    monkeypatch.setattr(api.settings, "openai_api_key", "")
    monkeypatch.setattr(api.settings, "pinecone_api_key", "")
    monkeypatch.setattr(api.retrieval, "search_stages", fake_stages)
    c = TestClient(api.app)
    body = {"question": "q", "mode": "keyword"}
    assert c.post("/ask/stream", json={**body, "generate": False}).status_code == 200
    assert c.post("/ask/stream", json=body).status_code == 503


def test_stream_reports_daily_limit_instead_of_answering(client, monkeypatch):
    monkeypatch.setattr(api.retrieval, "search_stages", fake_stages)
    monkeypatch.setattr(api, "answer_budget", DailyBudget(1))
    monkeypatch.setattr(generation, "_client", lambda: FakeLLM("Answer [1]."))

    first = [n for n, _ in events(client.post("/ask/stream", json={"question": "q"}))]
    second = [n for n, _ in events(client.post("/ask/stream", json={"question": "q"}))]

    assert "citations" in first
    assert second == ["vector", "keyword", "fusion", "context", "limited", "done"]
    assert client.post("/ask", json={"question": "q"}).status_code == 429


def test_stream_turns_a_mid_stream_failure_into_an_error_event(client, monkeypatch):
    def failing_stages(question, k, mode):
        yield Stage("vector", 1.0, [chunk(1)])
        raise APIConnectionError(request=None)

    monkeypatch.setattr(api.retrieval, "search_stages", failing_stages)
    evs = events(client.post("/ask/stream", json={"question": "q"}))
    assert [n for n, _ in evs] == ["vector", "error", "done"]
    assert evs[1][1] == {"detail": "Upstream error: APIConnectionError"}


def test_internal_key_locks_everything_but_health(client, monkeypatch):
    monkeypatch.setattr(api.settings, "internal_api_key", "s3cret")
    monkeypatch.setattr(api.retrieval, "search", lambda q, k, mode: [])

    assert client.get("/health").status_code == 200
    assert client.get("/search", params={"q": "x"}).status_code == 401
    wrong = {"X-Internal-Key": "nope"}
    assert client.get("/search", params={"q": "x"}, headers=wrong).status_code == 401
    right = {"X-Internal-Key": "s3cret"}
    assert client.get("/search", params={"q": "x"}, headers=right).status_code == 200


def test_rate_limit_counts_per_forwarded_ip_only_behind_the_key(client, monkeypatch):
    monkeypatch.setattr(api, "rate_limiter", RateLimiter(1))
    monkeypatch.setattr(api.retrieval, "search", lambda q, k, mode: [])

    def get(headers):
        return client.get("/search", params={"q": "x"}, headers=headers).status_code

    # No key configured: X-Client-IP is ignored, so both requests count as one client.
    assert get({"X-Client-IP": "1.1.1.1"}) == 200
    assert get({"X-Client-IP": "2.2.2.2"}) == 429

    # Key configured: the frontend's forwarded IP identifies the user.
    monkeypatch.setattr(api, "rate_limiter", RateLimiter(1))
    monkeypatch.setattr(api.settings, "internal_api_key", "s3cret")
    assert get({"X-Internal-Key": "s3cret", "X-Client-IP": "1.1.1.1"}) == 200
    assert get({"X-Internal-Key": "s3cret", "X-Client-IP": "2.2.2.2"}) == 200
    assert get({"X-Internal-Key": "s3cret", "X-Client-IP": "1.1.1.1"}) == 429
