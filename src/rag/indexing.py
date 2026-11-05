"""CLI: documents.jsonl -> chunks -> embeddings -> Pinecone, re-embedding only what changed.

  rag-index                 index new/changed pages, delete removed ones
  rag-index --limit 20      at most 20 changed pages (a cheap test run)
  rag-index --force         re-embed everything (e.g. after changing chunk settings)

Sync rules, driven by the manifest (see rag/store.py):
  page hash unchanged      -> skip, nothing is embedded
  page new or changed      -> chunk, embed, upsert; delete leftover chunks if it shrank
  page no longer in docs   -> delete all its chunks

Crash safety: Pinecone is written first and the manifest last. If a run dies halfway,
unfinished pages still have their old hash in the manifest and are redone next time;
deterministic ids (path#index) make redoing a page an overwrite, so runs are idempotent.
"""

import argparse
import json
import sys
import time
from collections.abc import Callable

from rag.chunking import chunk_document
from rag.config import settings
from rag.models import Chunk, Document
from rag.store import delete_chunks, delete_document, upsert_chunks

# Chunks per embedding round trip (small pages share one request).
GROUP_CHUNKS = 100
# text-embedding-3-small list price, USD per 1M tokens.
PRICE_PER_M_TOKENS = 0.02


def index_documents(
    docs: list[Document],
    index,
    embed: Callable[[list[str]], list[list[float]]],
    manifest: dict[str, dict],
    save: Callable[[dict[str, dict]], None] = lambda m: None,
    force: bool = False,
    limit: int | None = None,
) -> dict:
    """Bring the index in line with `docs`. Mutates and saves `manifest`. Returns stats."""
    start = time.perf_counter()
    changed = [
        d for d in docs if force or manifest.get(d.path, {}).get("content_hash") != d.content_hash
    ]
    skipped = len(docs) - len(changed)
    if limit is not None:
        changed = changed[:limit]

    stats = {
        "pages_indexed": 0,
        "pages_skipped": skipped,
        "pages_deleted": 0,
        "chunks": 0,
        "tokens": 0,
    }

    group: list[tuple[Document, list[Chunk]]] = []
    for doc in changed:
        group.append((doc, chunk_document(doc)))
        if sum(len(chunks) for _, chunks in group) >= GROUP_CHUNKS:
            _index_group(group, index, embed, manifest, stats)
            save(manifest)
            group = []
    if group:
        _index_group(group, index, embed, manifest, stats)

    current = {d.path for d in docs}
    for path in [p for p in manifest if p not in current]:
        delete_document(index, path, manifest[path]["chunk_count"])
        del manifest[path]
        stats["pages_deleted"] += 1
    save(manifest)

    stats["est_cost_usd"] = round(stats["tokens"] / 1e6 * PRICE_PER_M_TOKENS, 4)
    stats["seconds"] = round(time.perf_counter() - start, 1)
    return stats


def _index_group(group, index, embed, manifest, stats) -> None:
    chunks = [c for _, doc_chunks in group for c in doc_chunks]
    vectors = embed([c.text for c in chunks])
    if len(vectors) != len(chunks):
        raise RuntimeError(f"embedder returned {len(vectors)} vectors for {len(chunks)} chunks")
    doc_meta = {doc.path: {"url": doc.url, "title": doc.title} for doc, _ in group}
    upsert_chunks(index, chunks, vectors, doc_meta)

    for doc, doc_chunks in group:
        old_count = manifest.get(doc.path, {}).get("chunk_count", 0)
        if old_count > len(doc_chunks):  # page shrank: path#new..path#old are stale
            delete_chunks(index, doc.path, len(doc_chunks), old_count)
        manifest[doc.path] = {"content_hash": doc.content_hash, "chunk_count": len(doc_chunks)}

    stats["pages_indexed"] += len(group)
    stats["chunks"] += len(chunks)
    stats["tokens"] += sum(c.token_count for c in chunks)
    print(f"  indexed {stats['pages_indexed']} pages, {stats['chunks']} chunks", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--force", action="store_true", help="re-embed every page")
    parser.add_argument("--limit", type=int, help="index at most N changed pages")
    args = parser.parse_args()

    missing = [k for k in ("openai_api_key", "pinecone_api_key") if not getattr(settings, k)]
    if missing:
        sys.exit(f"Set {', '.join(m.upper() for m in missing)} in .env first.")
    if not settings.documents_path.exists():
        sys.exit(f"{settings.documents_path} not found. Run rag-ingest first.")

    # Imported here so `rag-index --help` works without credentials.
    from rag.embeddings import embed_texts
    from rag.keyword import chunks_from_documents, save_chunks
    from rag.store import ensure_index, get_index, load_manifest, save_manifest

    with settings.documents_path.open(encoding="utf-8") as f:
        docs = [Document.model_validate_json(line) for line in f if line.strip()]

    ensure_index()
    stats = index_documents(
        docs,
        get_index(),
        embed_texts,
        load_manifest(),
        save=save_manifest,
        force=args.force,
        limit=args.limit,
    )
    # The keyword index's copy of the chunks, for the deployed API (see keyword.py).
    save_chunks(chunks_from_documents(docs), settings.keyword_chunks_path)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
