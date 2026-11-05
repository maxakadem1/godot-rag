"""Text -> vectors with the OpenAI embeddings API.

Chunks and questions must be embedded by the same model, or their vectors aren't
comparable. Texts are sent in batches of BATCH_SIZE to cut round trips; the OpenAI SDK
retries 429s and 5xxs with exponential backoff, and max_retries is raised because a
full index run can briefly exceed the tokens-per-minute limit.
"""

from functools import lru_cache

from openai import OpenAI

from rag.config import settings

BATCH_SIZE = 100


@lru_cache
def _client() -> OpenAI:
    return OpenAI(api_key=settings.openai_api_key, max_retries=8)


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts in batches. Returns one vector per input, in input order."""
    vectors: list[list[float]] = []
    for start in range(0, len(texts), BATCH_SIZE):
        batch = texts[start : start + BATCH_SIZE]
        response = _client().embeddings.create(
            model=settings.embedding_model,
            input=batch,
            dimensions=settings.embedding_dimensions,
        )
        vectors += [item.embedding for item in sorted(response.data, key=lambda d: d.index)]
    return vectors


def embed_query(question: str) -> list[float]:
    return embed_texts([question])[0]
