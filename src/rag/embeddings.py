"""Step 2b: turn text into vectors with the embedding model.

The embedding model is NOT the chat model. Its only job is text -> numbers so that
texts with similar meaning end up close together. The LLM never sees these vectors.

Plan:
- Use the OpenAI embeddings API (settings.embedding_model).
- Send in batches (e.g. 100 texts per request) to stay fast and under rate limits.
- Retry with backoff on rate-limit / transient errors.
- The SAME model must embed both the chunks and the user's question,
  otherwise the vectors are not comparable.
"""


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns one vector per input, same order."""
    raise NotImplementedError("TODO: milestone 2")


def embed_query(question: str) -> list[float]:
    """Embed a single user question."""
    return embed_texts([question])[0]
