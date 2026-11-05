"""HTTP API. Run with: uvicorn rag.api:app --reload"""

import json
import logging
import secrets
import time
from collections.abc import Iterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from openai import OpenAIError
from pinecone.exceptions import PineconeException
from pydantic import BaseModel, Field

from rag import generation, retrieval
from rag.config import settings
from rag.limits import DailyBudget, RateLimiter
from rag.models import RetrievedChunk
from rag.retrieval import SearchMode

logger = logging.getLogger("rag.api")

MAX_K = 20


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    # Build the BM25 index up front so the first request doesn't pay for it.
    if settings.keyword_chunks_path.exists() or settings.documents_path.exists():
        from rag.keyword import get_keyword_index

        start = time.perf_counter()
        n = len(get_keyword_index().chunks)
        logger.info("keyword index ready: %d chunks in %.1fs", n, time.perf_counter() - start)
    else:
        logger.warning("%s missing; keyword/hybrid search unavailable", settings.documents_path)
    if not settings.internal_api_key:
        logger.warning("INTERNAL_API_KEY not set: the API is open to anyone who can reach it")
    yield


app = FastAPI(
    title="Godot Docs RAG",
    description="Question answering over the Godot Engine documentation, with citations.",
    lifespan=lifespan,
)


# Module-level so tests can swap them for fresh ones.
rate_limiter = RateLimiter(settings.rate_limit_per_minute)
answer_budget = DailyBudget(settings.daily_answer_limit)

OPEN_PATHS = {"/health"}


@app.middleware("http")
async def require_internal_key(request: Request, call_next):
    """With INTERNAL_API_KEY set, only callers holding it (the web frontend's server)
    get past /health. compare_digest takes the same time whatever the input, so the
    key can't be guessed one character at a time from response timings."""
    key = settings.internal_api_key
    if key and request.url.path not in OPEN_PATHS:
        given = request.headers.get("x-internal-key", "")
        if not secrets.compare_digest(given.encode(), key.encode()):
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)


def client_ip(request: Request) -> str:
    """The end user's IP. Behind the frontend every request comes from the frontend's
    server, so it forwards the real IP in X-Client-IP. That header is only trusted
    when the key check is on, i.e. when the caller has proven it is the frontend."""
    forwarded = request.headers.get("x-client-ip")
    if settings.internal_api_key and forwarded:
        return forwarded
    return request.client.host if request.client else "unknown"


def rate_limited(request: Request) -> None:
    if not rate_limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many requests: try again in a minute")


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    mode: SearchMode = "hybrid"
    k: int = Field(default=settings.top_k, ge=1, le=MAX_K)


class Source(BaseModel):
    n: int = Field(description="The [n] marker used in the answer")
    title: str
    url: str
    heading_path: str


class AskResponse(BaseModel):
    answer: str
    sources: list[Source]


@app.exception_handler(OpenAIError)
@app.exception_handler(PineconeException)
async def upstream_error(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("upstream provider error")
    detail = f"Upstream error: {type(exc).__name__}"
    return JSONResponse(status_code=502, content={"detail": detail})


@app.exception_handler(FileNotFoundError)
async def missing_data(_: Request, exc: FileNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": str(exc)})


def _require_keys(mode: SearchMode, llm: bool) -> None:
    missing = []
    if (mode != "keyword" or llm) and not settings.openai_api_key:
        missing.append("OPENAI_API_KEY")
    if mode != "keyword" and not settings.pinecone_api_key:
        missing.append("PINECONE_API_KEY")
    if missing:
        raise HTTPException(503, f"Not configured: set {', '.join(missing)} in .env")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/search", response_model=list[RetrievedChunk], dependencies=[Depends(rate_limited)])
def search_endpoint(
    q: Annotated[str, Query(min_length=1, max_length=1000)],
    k: Annotated[int, Query(ge=1, le=MAX_K)] = settings.top_k,
    mode: SearchMode = "hybrid",
) -> list[RetrievedChunk]:
    """Retrieval only, with scores and no LLM call: the first place to look when an
    answer is wrong. `keyword` mode works without API keys."""
    _require_keys(mode, llm=False)
    return retrieval.search(q, k, mode)


@app.post("/ask", response_model=AskResponse, dependencies=[Depends(rate_limited)])
def ask(req: AskRequest) -> AskResponse:
    """Retrieve the top-k chunks, then answer from them with citations."""
    _require_keys(req.mode, llm=True)
    if not answer_budget.try_spend():
        raise HTTPException(429, "Daily answer limit reached: try again tomorrow")
    start = time.perf_counter()
    chunks = retrieval.search(req.question, req.k, req.mode)
    text, cited = generation.answer(req.question, chunks)
    logger.info(
        "ask mode=%s k=%d ms=%d retrieved=%s cited=%s",
        req.mode,
        req.k,
        (time.perf_counter() - start) * 1000,
        [c.id for c in chunks],
        cited,
    )
    sources = []
    for n in cited:
        c = chunks[n - 1]
        sources.append(Source(n=n, title=c.title, url=c.url, heading_path=c.heading_path))
    return AskResponse(answer=text, sources=sources)


class AskStreamRequest(AskRequest):
    generate: bool = Field(
        default=True, description="false stops after retrieval: no LLM call, no answer"
    )


class Hit(BaseModel):
    """A search result without its text, for the per-stage lists."""

    id: str
    rank: int
    score: float
    title: str
    heading_path: str
    url: str


def _hits(chunks: list[RetrievedChunk]) -> list[dict]:
    return [
        Hit(
            rank=i, **c.model_dump(include={"id", "score", "title", "heading_path", "url"})
        ).model_dump()
        for i, c in enumerate(chunks, start=1)
    ]


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _error_detail(exc: Exception) -> str:
    if isinstance(exc, (OpenAIError, PineconeException)):
        return f"Upstream error: {type(exc).__name__}"
    if isinstance(exc, FileNotFoundError):
        return str(exc)
    return "Internal error"


@app.post("/ask/stream", dependencies=[Depends(rate_limited)])
def ask_stream(req: AskStreamRequest) -> StreamingResponse:
    """The /ask pipeline as Server-Sent Events, one event per stage as it finishes:

    - `vector`, `keyword`: {ms, hits}: each search's candidates, best first
      (only the ones the mode uses)
    - `fusion`: {ms, hits}: hybrid only, all candidates re-ranked by RRF score
    - `context`: {chunks}: the top-k chunks the answer is built from; chunks[i] is [i+1]
    - `token`: {text}: a piece of the answer as the model writes it
    - `citations`: {cited, ms}: the [n] numbers the answer actually used
    - `limited`: {detail}: the daily answer limit was hit; no answer follows
    - `error`: {detail}: something failed mid-stream (the status is already 200)
    - `done`: {ms}: always last

    With generate=false the stream ends after `context` (retrieval only, no LLM cost).
    """
    _require_keys(req.mode, llm=req.generate)
    return StreamingResponse(
        _ask_events(req),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _ask_events(req: AskStreamRequest) -> Iterator[str]:
    start = time.perf_counter()
    chunks: list[RetrievedChunk] = []
    cited: list[int] = []
    try:
        for stage in retrieval.search_stages(req.question, req.k, req.mode):
            if stage.name == "context":
                chunks = stage.chunks
                yield _sse("context", {"chunks": [c.model_dump() for c in chunks]})
            else:
                yield _sse(stage.name, {"ms": stage.ms, "hits": _hits(stage.chunks)})

        if req.generate and not answer_budget.try_spend():
            detail = "Daily answer limit reached: showing retrieval only"
            yield _sse("limited", {"detail": detail})
        elif req.generate:
            gen_start = time.perf_counter()
            pieces = []
            for piece in generation.stream_answer(req.question, chunks):
                pieces.append(piece)
                yield _sse("token", {"text": piece})
            cited = generation.cited_numbers("".join(pieces), len(chunks))
            ms = round((time.perf_counter() - gen_start) * 1000, 1)
            yield _sse("citations", {"cited": cited, "ms": ms})
    except Exception as exc:
        logger.exception("ask/stream failed")
        yield _sse("error", {"detail": _error_detail(exc)})

    total_ms = round((time.perf_counter() - start) * 1000, 1)
    logger.info(
        "ask/stream mode=%s k=%d generate=%s ms=%d retrieved=%s cited=%s",
        req.mode,
        req.k,
        req.generate,
        total_ms,
        [c.id for c in chunks],
        cited,
    )
    yield _sse("done", {"ms": total_ms})
