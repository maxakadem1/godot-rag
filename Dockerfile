# API image. Needs data/documents.jsonl (from `rag-ingest`) in the build context:
# the BM25 index is built from it at startup. The vectors live in Pinecone.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TIKTOKEN_CACHE_DIR=/opt/tiktoken

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install . \
    # tiktoken downloads its tokenizer on first use; fetch it now so startup
    # doesn't depend on that download.
    && python -c "import tiktoken; tiktoken.get_encoding('cl100k_base')"

COPY data/documents.jsonl ./data/documents.jsonl

RUN useradd --create-home app
USER app

EXPOSE 8080
CMD ["uvicorn", "rag.api:app", "--host", "0.0.0.0", "--port", "8080"]
