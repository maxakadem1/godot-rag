-- Schema for the RAG index.
-- Runs automatically the first time the Postgres container starts with an empty volume.
-- To re-run from scratch: `docker compose down -v && docker compose up -d`

CREATE EXTENSION IF NOT EXISTS vector;

-- One row per source document (one Godot docs page).
CREATE TABLE IF NOT EXISTS documents (
    id            BIGSERIAL PRIMARY KEY,
    source        TEXT        NOT NULL,              -- e.g. 'godot-docs'
    path          TEXT        NOT NULL,              -- path inside the source repo
    url           TEXT        NOT NULL,              -- public URL, used for citations
    title         TEXT        NOT NULL,
    content_hash  TEXT        NOT NULL,              -- hash of the cleaned text; used to skip unchanged docs on re-sync
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, path)
);

-- One row per chunk. Chunks are what we embed and search over.
CREATE TABLE IF NOT EXISTS chunks (
    id            BIGSERIAL PRIMARY KEY,
    document_id   BIGINT      NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index   INT         NOT NULL,              -- order within the document
    heading_path  TEXT        NOT NULL DEFAULT '',   -- e.g. 'Signals > Connecting a signal in code'
    text          TEXT        NOT NULL,              -- the original text that gets put in the prompt
    token_count   INT         NOT NULL,
    content_hash  TEXT        NOT NULL,
    -- 1536 dimensions = OpenAI text-embedding-3-small. Change if you change the model.
    embedding     vector(1536),
    -- Full-text search column for the keyword half of hybrid search.
    tsv           tsvector GENERATED ALWAYS AS (to_tsvector('english', heading_path || ' ' || text)) STORED,
    UNIQUE (document_id, chunk_index)
);

-- Approximate nearest-neighbour index for vector search (cosine distance).
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
    ON chunks USING hnsw (embedding vector_cosine_ops);

-- Index for keyword search.
CREATE INDEX IF NOT EXISTS chunks_tsv_idx
    ON chunks USING gin (tsv);
