"""HTTP API. Run with: uvicorn rag.api:app --reload"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Godot Docs RAG")


class AskRequest(BaseModel):
    question: str


class Source(BaseModel):
    title: str
    url: str
    heading_path: str


class AskResponse(BaseModel):
    answer: str
    sources: list[Source]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/ask", response_model=AskResponse)
def ask(req: AskRequest) -> AskResponse:
    # Retrieval -> Augmentation -> Generation:
    #   chunks = retrieval.search(req.question, settings.top_k)
    #   text = generation.answer(req.question, chunks)
    raise HTTPException(status_code=501, detail="Not implemented yet (milestones 3-4)")
