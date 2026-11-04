"""Database access (Postgres + pgvector). Schema lives in db/init.sql.

Plan:
- connect(): psycopg connection with pgvector's register_vector() applied.
- upsert_document(): insert or update a row in `documents`; return its id.
  If content_hash is unchanged, skip (nothing to re-embed).
- replace_chunks(): delete a document's old chunks and insert the new ones with embeddings.
- delete_missing_documents(): remove documents whose source page no longer exists
  (otherwise search keeps returning deleted pages).
"""

import psycopg
from pgvector.psycopg import register_vector

from rag.config import settings


def connect() -> psycopg.Connection:
    conn = psycopg.connect(settings.database_url)
    register_vector(conn)
    return conn
