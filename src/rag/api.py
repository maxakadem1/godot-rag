"""HTTP API. Run with: uvicorn rag.api:app --reload"""

import logging
import time
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from openai import OpenAIError
from pinecone.exceptions import PineconeException
from pydantic import BaseModel, Field

from rag import generation, retrieval
from rag.config import settings
from rag.models import RetrievedChunk
from rag.retrieval import SearchMode

logger = logging.getLogger("rag.api")

MAX_K = 20


@asynccontextmanager
async def lifespan(_: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    # Build the BM25 index up front so the first request doesn't pay for it.
    if settings.documents_path.exists():
        from rag.keyword import get_keyword_index

        start = time.perf_counter()
        n = len(get_keyword_index().chunks)
        logger.info("keyword index ready: %d chunks in %.1fs", n, time.perf_counter() - start)
    else:
        logger.warning("%s missing; keyword/hybrid search unavailable", settings.documents_path)
    yield


app = FastAPI(
    title="Godot Docs RAG",
    description="Question answering over the Godot Engine documentation, with citations.",
    lifespan=lifespan,
)


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


@app.get("/search", response_model=list[RetrievedChunk])
def search_endpoint(
    q: Annotated[str, Query(min_length=1, max_length=1000)],
    k: Annotated[int, Query(ge=1, le=MAX_K)] = settings.top_k,
    mode: SearchMode = "hybrid",
) -> list[RetrievedChunk]:
    """Retrieval only, with scores and no LLM call: the first place to look when an
    answer is wrong. `keyword` mode works without API keys."""
    _require_keys(mode, llm=False)
    return retrieval.search(q, k, mode)


@app.post("/ask", response_model=AskResponse)
def ask(req: AskRequest) -> AskResponse:
    """Retrieve the top-k chunks, then answer from them with citations."""
    _require_keys(req.mode, llm=True)
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
