"""Vector storage in Pinecone (serverless) and the index manifest.

One Pinecone record per chunk:

- id:       "<doc path>#<chunk index>", e.g. "tutorials/scripting/signals.rst#3".
            Deterministic, so re-indexing a page overwrites its records instead of
            duplicating them.
- values:   the chunk embedding (settings.embedding_dimensions floats).
- metadata: path, url, title, heading_path, chunk_index, content_hash and the chunk
            text itself, so a query returns everything the prompt and citations need
            in one round trip. A ~500-token chunk is ~2 KB, well under Pinecone's
            40 KB metadata limit.

Pinecone has no documents table, so `data/index_manifest.json` records what is in the
index as {path: {"content_hash": ..., "chunk_count": ...}}. rag/indexing.py uses it to
skip unchanged pages, trim chunks when a page shrinks and delete removed pages.
"""

import json
import os
from functools import lru_cache
from pathlib import Path

from pinecone import Pinecone, ServerlessSpec

from rag.config import settings
from rag.models import Chunk

# Records per upsert request. Pinecone caps a request at ~2 MB; one record is ~30 KB
# of JSON floats plus ~2 KB of metadata.
UPSERT_BATCH = 50
# Pinecone accepts at most 1000 ids per delete request.
DELETE_BATCH = 1000


def chunk_id(document_path: str, chunk_index: int) -> str:
    return f"{document_path}#{chunk_index}"


@lru_cache
def _client() -> Pinecone:
    return Pinecone(api_key=settings.pinecone_api_key)


def ensure_index() -> None:
    """Create the index if it doesn't exist yet. Only the indexing CLI calls this."""
    pc = _client()
    if not pc.has_index(settings.pinecone_index):
        pc.create_index(
            name=settings.pinecone_index,
            dimension=settings.embedding_dimensions,
            metric="cosine",
            spec=ServerlessSpec(cloud=settings.pinecone_cloud, region=settings.pinecone_region),
        )


@lru_cache
def get_index():
    """Connection to the index, reused across requests (resolving the host is a network call)."""
    return _client().Index(settings.pinecone_index)


def load_manifest(path: Path | None = None) -> dict[str, dict]:
    path = path or settings.manifest_path
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_manifest(manifest: dict[str, dict], path: Path | None = None) -> None:
    """Write atomically, so a crash mid-write can't leave a truncated manifest."""
    path = path or settings.manifest_path
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)


def to_record(chunk: Chunk, vector: list[float], doc_meta: dict) -> dict:
    return {
        "id": chunk_id(chunk.document_path, chunk.chunk_index),
        "values": vector,
        "metadata": {
            "path": chunk.document_path,
            "url": doc_meta["url"],
            "title": doc_meta["title"],
            "heading_path": chunk.heading_path,
            "chunk_index": chunk.chunk_index,
            "content_hash": chunk.content_hash,
            "text": chunk.text,
        },
    }


def upsert_chunks(index, chunks: list[Chunk], vectors: list[list[float]], doc_meta: dict) -> None:
    """Write chunks and their embeddings. doc_meta maps document path -> {url, title}."""
    records = [
        to_record(c, v, doc_meta[c.document_path]) for c, v in zip(chunks, vectors, strict=True)
    ]
    index.upsert(vectors=records, batch_size=UPSERT_BATCH, show_progress=False)


def delete_chunks(index, document_path: str, start: int, stop: int) -> None:
    """Delete ids path#start .. path#(stop-1).

    Ids are deterministic, so the manifest's chunk count tells us which exist without
    listing them in Pinecone.
    """
    ids = [chunk_id(document_path, i) for i in range(start, stop)]
    for i in range(0, len(ids), DELETE_BATCH):
        index.delete(ids=ids[i : i + DELETE_BATCH])


def delete_document(index, document_path: str, chunk_count: int) -> None:
    delete_chunks(index, document_path, 0, chunk_count)
