"""Step 2a: split documents into chunks.

See docs/02-architecture.md ("Chunking") for the reasoning.

Plan:
- Split along the sections produced by ingestion (headings), not raw character counts.
- Target ~300-500 tokens per chunk (measure with tiktoken), with a small overlap
  (~50 tokens) when a long section has to be split further.
- Merge tiny sections (e.g. a heading with one sentence) into their neighbour.
- Prefix each chunk's text with its title + heading path so the embedding knows the context,
  e.g. "Using signals > Connecting a signal in code\n\n<text>".
- Every chunk keeps its document's metadata (path, url, title) for citations.
"""

from rag.models import Chunk, Document


def chunk_document(doc: Document, max_tokens: int = 500, overlap_tokens: int = 50) -> list[Chunk]:
    """Split one document into chunks."""
    raise NotImplementedError("TODO: milestone 2")
