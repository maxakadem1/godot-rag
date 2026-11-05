"""In-memory BM25 keyword search over the same chunks that are in Pinecone.

Embeddings match meaning but blur exact identifiers: a question about
`get_node_or_null` can retrieve `get_node` or `find_child`. BM25 rewards exact term
matches, weighted by how rare the term is (IDF), with diminishing returns for repeats
(K1) and normalised for chunk length (B).

The ~8.6k chunks fit comfortably in memory and a query takes milliseconds. Chunking
the documents at startup takes seconds, so `rag-index` also saves the chunks to a
small gzipped file that the API loads instead (serverless cold starts stay short).
At much larger scale this would move to a search engine (OpenSearch) or Pinecone
sparse vectors.
"""

import gzip
import heapq
import math
import re
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path

from rag.config import settings
from rag.models import Document, RetrievedChunk
from rag.store import chunk_id

K1 = 1.5  # term-frequency saturation
B = 0.75  # length normalisation (0 = none, 1 = full)

_WORD_RE = re.compile(r"[a-z0-9_]+")


def tokenize(text: str) -> list[str]:
    """Lowercase words. snake_case identifiers are kept whole and also split, so
    `move_and_slide` matches both "move_and_slide" and "move and slide"."""
    words = []
    for w in _WORD_RE.findall(text.lower()):
        words.append(w)
        if "_" in w:
            words += [p for p in w.split("_") if p]
    return words


class KeywordIndex:
    """Inverted index: word -> [(chunk position, term count)]."""

    def __init__(self, chunks: list[RetrievedChunk]):
        self.chunks = chunks
        self.postings: dict[str, list[tuple[int, int]]] = defaultdict(list)
        self.lengths: list[int] = []
        for i, chunk in enumerate(chunks):
            counts = Counter(tokenize(chunk.text))
            self.lengths.append(sum(counts.values()))
            for word, n in counts.items():
                self.postings[word].append((i, n))
        self.avg_length = sum(self.lengths) / max(len(chunks), 1)

    def idf(self, word: str) -> float:
        n_total, n_with = len(self.chunks), len(self.postings.get(word, []))
        return math.log(1 + (n_total - n_with + 0.5) / (n_with + 0.5))

    def search(self, query: str, top_k: int = 5) -> list[RetrievedChunk]:
        scores: dict[int, float] = defaultdict(float)
        for word in set(tokenize(query)):
            idf = self.idf(word)
            for i, tf in self.postings.get(word, []):
                length_norm = 1 - B + B * self.lengths[i] / self.avg_length
                scores[i] += idf * tf * (K1 + 1) / (tf + K1 * length_norm)
        best = heapq.nlargest(top_k, scores, key=scores.__getitem__)
        return [self.chunks[i].model_copy(update={"score": scores[i]}) for i in best]


def chunks_from_documents(docs: list[Document]) -> list[RetrievedChunk]:
    """The same chunks Pinecone holds (same chunker, same ids), as search results."""
    # Imported here: the chunker loads a tokenizer, which the API doesn't need when
    # it reads the saved chunks file.
    from rag.chunking import chunk_document

    return [
        RetrievedChunk(
            id=chunk_id(c.document_path, c.chunk_index),
            path=c.document_path,
            text=c.text,
            heading_path=c.heading_path,
            title=doc.title,
            url=doc.url,
            score=0.0,
        )
        for doc in docs
        for c in chunk_document(doc)
    ]


def save_chunks(chunks: list[RetrievedChunk], path: Path) -> None:
    """Write chunks as gzipped JSON lines. mtime=0 keeps the bytes identical for the
    same chunks, so an unchanged file doesn't show up as changed in git."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.GzipFile(path, "wb", mtime=0) as f:
        for c in chunks:
            f.write(c.model_dump_json().encode() + b"\n")


def load_chunks(path: Path) -> list[RetrievedChunk]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return [RetrievedChunk.model_validate_json(line) for line in f if line.strip()]


@lru_cache
def get_keyword_index() -> KeywordIndex:
    """Built once per process: from the saved chunks file if there is one (fast),
    otherwise by chunking data/documents.jsonl."""
    if settings.keyword_chunks_path.exists():
        return KeywordIndex(load_chunks(settings.keyword_chunks_path))
    path = settings.documents_path
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run rag-ingest first.")
    with path.open(encoding="utf-8") as f:
        docs = [Document.model_validate_json(line) for line in f if line.strip()]
    return KeywordIndex(chunks_from_documents(docs))


def keyword_search(question: str, top_k: int = 5) -> list[RetrievedChunk]:
    return get_keyword_index().search(question, top_k)
