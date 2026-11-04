"""Data shapes passed between pipeline stages."""

from pydantic import BaseModel


class Section(BaseModel):
    """A heading and the text under it, before chunking."""

    heading_path: list[str]  # e.g. ["Using signals", "Connecting a signal in code"]
    text: str


class Document(BaseModel):
    """One cleaned source page. Output of ingestion, input to chunking."""

    source: str  # "godot-docs"
    path: str  # path inside the source repo, e.g. "tutorials/scripting/signals.rst"
    url: str  # public URL for citations
    title: str
    sections: list[Section]
    content_hash: str  # sha256 of the cleaned text; lets sync skip unchanged pages


class Chunk(BaseModel):
    """A piece of a document small enough to embed and put in a prompt."""

    document_path: str
    chunk_index: int
    heading_path: str  # "A > B > C"
    text: str
    token_count: int
    content_hash: str


class RetrievedChunk(BaseModel):
    """A chunk returned by search, with what the citation needs."""

    text: str
    heading_path: str
    title: str
    url: str
    score: float
