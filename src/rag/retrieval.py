"""Step 3: find the chunks most relevant to a question.

This is plain code + math. No LLM is involved here, only the embedding model
(to embed the question) and the database (to compare vectors).

Plan, in stages:
1. Vector search: embed the question, ORDER BY embedding <=> query_vector LIMIT k
   (`<=>` is pgvector's cosine distance operator).
2. Keyword search: the `tsv` column with websearch_to_tsquery(), so exact names like
   `CharacterBody2D` or `move_and_slide` are found even when embeddings miss them.
3. Hybrid: merge both result lists with Reciprocal Rank Fusion (RRF).
4. (Later) Rerank: fetch ~20 candidates, keep the best 5 with a reranker model.

Measure each stage with the eval set (eval/) before keeping it.
"""

from rag.models import RetrievedChunk


def search(question: str, top_k: int = 5) -> list[RetrievedChunk]:
    raise NotImplementedError("TODO: milestone 3")
