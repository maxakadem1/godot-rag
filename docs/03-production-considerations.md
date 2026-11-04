# Production considerations

A RAG demo takes a weekend; a reliable production system takes months. The LLM call is one line. Most of the work is **data engineering and quality control**, especially ingestion, permissions and evaluation.

Items marked ✅ are covered in this project, 🟡 are planned, and ➖ don't apply to public docs but matter at a company.

## 1. Ingestion pipeline (usually the biggest chunk of work)

- **Connectors** to wherever data lives (Contentful, Confluence, Google Drive, Jira, databases, PDFs). Here: a git repo ✅
- **Parsing and cleaning** with code first, LLM only for genuinely messy input ✅
  - Contentful rich-text JSON → Markdown; Confluence storage XHTML → Markdown; Jira API fields → doc
- **Chunking strategy**: size, overlap, split by headings 🟡
- **Metadata** captured at fetch time: source, URL, title, last updated, permissions. Much harder to add later ✅
- **Sync**: re-embed changed docs (webhooks, e.g. Contentful publish events, or scheduled crawls), delete removed ones, avoid duplicates. Content hashes mean only real changes get re-embedded 🟡

## 2. Storage and search

- Embedding model choice: cost, quality, languages ✅ ([decisions](05-decisions.md))
- Vector store: companies usually prefer what they already run (pgvector in existing Postgres, OpenSearch). Here: Pinecone, a managed vector DB, so there's no database to run ✅
- **Hybrid search**: embeddings are bad at exact names, IDs and error codes 🟡
- **Reranking** 🟡

## 3. Permissions and security

- ➖ Users must only get answers from docs they're allowed to see, so search results are filtered by their access. **Skipping this means building a data leak.**
- ➖ PII / confidential data, and what may leave the network if you use a hosted LLM
- 🟡 **Prompt injection**: a document can contain "ignore your instructions…". Retrieved text is treated as untrusted data.

## 4. Prompt and generation

- Answer only from context, cite sources, say "I don't know" 🟡
- Rewrite follow-up questions into standalone ones before searching 🟡

## 5. Evaluation (what separates a demo from production)

- A **test set** of real questions with known good source pages / answers 🟡
- Measure:
  - **Retrieval**: did the right chunk come back? (hit rate / recall@k, MRR)
  - **Faithfulness**: does the answer stick to the retrieved text?
  - **Relevance**: does it actually answer the question?
  - Answer-level checks are often scored automatically with an LLM as the judge
- **Re-run on every change** to chunking, models or prompts, so you know if quality went up or down. Without this you're tuning blind.

## 6. Operations

- **Latency**: streaming, caching common questions
- **Cost**: track tokens, use smaller models where good enough
- **Monitoring and logging**: failed questions, empty retrievals, thumbs up/down. These logs are the best source of new test cases.
- Rate limits, retries, fallbacks when the provider is slow or down

## 7. Product layer

- Chat UI: streaming, sources, feedback buttons, loading/error states 🟡
- An API/SDK so other teams can use it

## Interview angle

Talking about **evaluation, permissions and keeping data in sync** shows you understand the real work, not just the tutorial version. Be ready to explain:
- Why this chunk size, and what you measured
- How sync works, and what happens when a page is deleted
- How you know a change made things better
