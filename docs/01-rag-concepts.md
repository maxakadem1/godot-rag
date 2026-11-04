# RAG concepts

## What RAG is

**Retrieval-Augmented Generation**: before asking the LLM a question, search your own data for the relevant pieces and include them in the prompt, so the model answers from your data instead of its own memory.

> RAG = a meaning-based search over our own data. When a user asks something, we search for the most relevant chunks and give their text to the LLM along with the question. We keep the search current by re-embedding docs when they change.

## Why it exists

- **The model doesn't know our data.** An LLM's knowledge is frozen at training time and never included private or newer content.
- **The data is too big to send every time.** It won't fit in the context window, and sending it all would be slow and expensive.
- So: **fetch only the relevant pieces for each question.**

## Embeddings

An embedding is a list of numbers (a vector) that represents the *meaning* of a piece of text. Texts with similar meaning get vectors that are close together.

- Embeddings are **for search**. The chat LLM never sees them.
- After the search, the **original text** of the matching chunks goes into the prompt. That's what the LLM reads.
- They're made by a separate **embedding model** whose only job is text → vector. It doesn't answer questions.
- The same embedding model must embed both the documents and the question, otherwise the vectors aren't comparable.

### Meaning search vs keyword search

| Keyword search | Embedding (semantic) search |
|---|---|
| Finds text containing the exact words | Finds text about the same *idea* |
| "Contentful" only matches "Contentful" | "how does the widget pull content from our CMS?" can match the Contentful docs |
| Great for exact names, IDs, error codes | Weak on exact names, IDs, error codes |

Because each is strong where the other is weak, production systems often combine them (**hybrid search**).

**You embed the whole question as written.** You don't extract keywords first. Capturing meaning is the whole point.

## What "dynamic" means

"Dynamic" describes the **retrieval**, not the embeddings.

- Embedding the dataset is like **building a search index**. It's done ahead of time so search is fast.
- What's dynamic is that **each question pulls a different set of chunks**, chosen at question time.

What it's compared against:

| Approach | Problem |
|---|---|
| Model's own memory (training data) | Fixed; changing it means retraining/fine-tuning, which is slow and expensive |
| Same fixed docs pasted into every prompt | Mostly irrelevant context; doesn't scale |
| **RAG** | Relevant context per question; update knowledge by updating documents |

**Embedding isn't a one-time job.** When a doc changes, re-embed just that doc's chunks (seconds, almost free). The index doesn't update itself: a sync process has to do it, or search keeps returning stale text.

## Benefits

- **Updating what the AI knows = updating a document.** No retraining.
- **Fewer made-up answers**: the model answers from real text it was given.
- **Citations**: you know exactly which chunks were used.
- **Access control**: filter what each user's search can return.

## The name, step by step

| Letter | Step | Done by |
|---|---|---|
| **R**etrieval | Embed the question, find the closest chunks | Your code + embedding model + vector DB |
| **A**ugmented | Put the retrieved text into the prompt | Your code |
| **G**eneration | Write the answer | The LLM |

The LLM only takes part in the last step, and it has no idea a search happened. It just gets a prompt that already contains the right information.
