# Evaluation (milestone 5)

Without an eval set, every change (chunk size, hybrid search, prompt) is a guess. With one, you can say "hybrid search raised hit rate@5 from X% to Y%".

## Question set

`questions.jsonl`, one JSON object per line:

```json
{"id": "signals-code", "question": "How do I connect a signal in code?", "expected_paths": ["getting_started/step_by_step/signals.rst"]}
```

- `expected_paths`: page(s) a correct answer should come from (paths inside the godot-docs repo)
- Aim for 30–50 questions. Mix:
  - how-to questions (tutorials)
  - API questions (class reference)
  - questions using exact names (`move_and_slide`) and ones that describe things in other words
  - a few the docs **can't** answer (the system should say so)
- Write them like a real user would, not copied from headings

`questions.example.jsonl` has a few to start from (paths verified against the docs).

## Metrics

| Metric | Measures | How |
|---|---|---|
| Hit rate@k | Did any expected page appear in the top k chunks? | Code |
| MRR | How high was the first correct result? | Code |
| Faithfulness | Is every claim in the answer supported by the retrieved text? | LLM-as-judge |
| Relevance | Does the answer address the question? | LLM-as-judge |

Write results to `eval/results/` (git-ignored) and copy the summary table into the main README.
