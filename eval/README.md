# Evaluation

`questions.jsonl` holds 38 hand-written questions, one JSON object per line:

```json
{"id": "get-node-or-null", "kind": "exact", "question": "What does get_node_or_null return?", "expected_paths": ["classes/class_node.rst"]}
```

- `expected_paths`: the page(s) in the godot-docs repo that answer the question. Any chunk from one of them counts as a hit.
- `kind`: what the question tests, so results can be split by type.

| Kind | Count | Example |
|---|---|---|
| `exact` | 14 | uses an API name verbatim (`get_node_or_null`, `_physics_process`) |
| `concept` | 12 | how-to phrasing that shares vocabulary with the docs |
| `paraphrase` | 10 | describes the problem in the user's words, with little word overlap with the answer page |
| `unanswerable` | 2 | not covered by the docs; skipped by retrieval metrics |

Questions are written the way a user would ask, not copied from headings, and mix tutorials with class-reference pages. `rag-eval` checks that every expected path exists in `data/documents.jsonl` before running, so a typo fails loudly instead of counting as a miss.

## Running

```bash
rag-eval --modes keyword --show-misses   # offline, no API keys
rag-eval                                 # hybrid, vector and keyword (needs a full rag-index)
```

The command prints a Markdown table and writes full per-question results to `eval/results/` (git-ignored).

## Metrics

| Metric | Question it answers |
|---|---|
| Hit rate@k | Was a chunk from a correct page anywhere in the top k? |
| MRR | How high was the first correct chunk? (mean of 1/rank, 0 if missing) |

Both are needed: two systems can have the same hit rate while one puts the answer at #1 and the other at #5.

Reading the misses matters as much as the numbers. One early "miss" turned out to be a labelling error: the profiler question is also answered by `cpu_optimization.rst`, which is now in its expected paths.
