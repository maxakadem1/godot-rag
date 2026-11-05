"""API tests: request validation, error mapping and /ask wiring, with no network calls."""

import pytest
from fastapi.testclient import TestClient
from openai import APIConnectionError

from rag import api, generation
from rag.models import RetrievedChunk

from .test_generation import FakeLLM, chunk


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
