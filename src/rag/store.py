"""Vector storage in Pinecone (serverless).

One Pinecone record per chunk:
- id:       "<doc path>#<chunk index>", e.g. "tutorials/scripting/signals.rst#3".
            Deterministic, so re-indexing a page overwrites its records instead of
            duplicating them.
- values:   the chunk's embedding (settings.embedding_dimensions floats)
- metadata: path, url, title, heading_path, chunk_index, content_hash, and the chunk
            `text` itself, so search results can go straight into the prompt without a
            second lookup. Pinecone allows up to 40 KB of metadata per record; a
            ~500-token chunk is ~2 KB.

Pinecone has no table of documents, so `data/index_manifest.json` records what's in the
index: {path: {"content_hash": ..., "chunk_count": ...}}. Sync uses it to:
- skip pages whose content_hash is unchanged (nothing to re-embed)
- delete a changed page's leftover chunks when it now has fewer chunks than before
- delete every chunk of a page that no longer exists (otherwise search keeps
  returning deleted pages)

Plan (milestone 2):
- upsert_chunks(): embed-and-write one document's chunks in batches.
- delete_document(): delete ids path#0 .. path#(n-1) using the manifest's chunk count.
"""

import json
from pathlib import Path

from pinecone import Pinecone, ServerlessSpec

from rag.config import settings
from rag.models import Chunk


def chunk_id(document_path: str, chunk_index: int) -> str:
    return f"{document_path}#{chunk_index}"


def get_index():
    """Connect to the Pinecone index, creating it on first use."""
    pc = Pinecone(api_key=settings.pinecone_api_key)
    if not pc.has_index(settings.pinecone_index):
        pc.create_index(
            name=settings.pinecone_index,
            dimension=settings.embedding_dimensions,
            metric="cosine",
            spec=ServerlessSpec(cloud=settings.pinecone_cloud, region=settings.pinecone_region),
        )
    return pc.Index(settings.pinecone_index)


def load_manifest(path: Path | None = None) -> dict[str, dict]:
    path = path or settings.manifest_path
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_manifest(manifest: dict[str, dict], path: Path | None = None) -> None:
    path = path or settings.manifest_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")


def upsert_chunks(index, chunks: list[Chunk], vectors: list[list[float]], doc_meta: dict) -> None:
    """Write one document's chunks + embeddings. doc_meta carries path, url, title."""
    raise NotImplementedError("TODO: milestone 2")


def delete_document(index, document_path: str, chunk_count: int) -> None:
    """Remove all of a page's chunks."""
    raise NotImplementedError("TODO: milestone 2")
