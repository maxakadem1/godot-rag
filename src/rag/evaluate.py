"""CLI: score retrieval against a labelled question set.

  rag-eval                          keyword, vector and hybrid (vector needs API keys)
  rag-eval --modes keyword          works offline
  rag-eval --k 5 --show-misses

Each question lists the page(s) that answer it ("expected_paths"). For each search
mode we record the rank of the first chunk from a correct page, then report:

- hit rate@k: share of questions with a correct page anywhere in the top k
- MRR: mean of 1/rank of the first correct result (0 when it is missing)

Results are split by question kind (exact API names, concepts, paraphrases), because
each search mode is strong on different kinds. "Unanswerable" questions have no
expected page and are skipped here.
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from rag.retrieval import SEARCH_MODES

DEFAULT_QUESTIONS = Path("eval/questions.jsonl")
RESULTS_DIR = Path("eval/results")


def load_questions(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def first_hit_rank(result_paths: list[str], expected: list[str]) -> int | None:
    """1-based rank of the first result from a correct page, or None."""
    for rank, path in enumerate(result_paths, start=1):
        if path in expected:
            return rank
    return None


def summarize(ranks: list[int | None], k: int) -> dict:
    """Hit rate@k and MRR from each question's first-hit rank."""
    n = len(ranks)
    if n == 0:
        return {"n": 0, "hit_rate": 0.0, "mrr": 0.0}
    hits = [r for r in ranks if r is not None and r <= k]
    return {
        "n": n,
        "hit_rate": round(len(hits) / n, 3),
        "mrr": round(sum(1 / r for r in hits) / n, 3),
    }


def evaluate(questions: list[dict], search, k: int) -> dict:
    """Run every answerable question through `search(question, k)` and score it."""
    per_question = []
    for q in questions:
        if not q["expected_paths"]:
            continue
        paths = [c.path for c in search(q["question"], k)]
        per_question.append({**q, "rank": first_hit_rank(paths, q["expected_paths"]), "got": paths})

    kinds = sorted({q.get("kind", "all") for q in per_question})
    return {
        "overall": summarize([q["rank"] for q in per_question], k),
        "by_kind": {
            kind: summarize([q["rank"] for q in per_question if q.get("kind", "all") == kind], k)
            for kind in kinds
        },
        "questions": per_question,
    }


def check_paths(questions: list[dict], documents_path: Path) -> None:
    """Fail loudly on an expected page that doesn't exist: a typo would silently cost a miss."""
    with documents_path.open(encoding="utf-8") as f:
        known = {json.loads(line)["path"] for line in f if line.strip()}
    bad = [(q["id"], p) for q in questions for p in q["expected_paths"] if p not in known]
    if bad:
        sys.exit(f"Unknown expected_paths: {bad}")


def markdown_table(results: dict, k: int) -> str:
    kinds = list(next(iter(results.values()))["by_kind"])
    header = f"| Mode | Hit rate@{k} | MRR | " + " | ".join(f"{kind} hit@{k}" for kind in kinds)
    lines = [header + " |", "|" + "---|" * (3 + len(kinds))]
    for mode, r in results.items():
        cells = [f"{s['hit_rate']:.0%} (n={s['n']})" for s in (r["by_kind"][k] for k in kinds)]
        lines.append(
            f"| {mode} | {r['overall']['hit_rate']:.0%} | {r['overall']['mrr']:.2f} | "
            + " | ".join(cells)
            + " |"
        )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)
    parser.add_argument("--modes", default=",".join(SEARCH_MODES[::-1]))
    parser.add_argument("--k", type=int, default=5)
    parser.add_argument("--show-misses", action="store_true")
    args = parser.parse_args()

    modes = [m.strip() for m in args.modes.split(",") if m.strip()]
    unknown = [m for m in modes if m not in SEARCH_MODES]
    if unknown:
        sys.exit(f"Unknown mode(s) {unknown}; choose from {', '.join(SEARCH_MODES)}")

    from rag.config import settings
    from rag.retrieval import search

    questions = load_questions(args.questions)
    check_paths(questions, settings.documents_path)

    results = {
        mode: evaluate(questions, lambda q, k, m=mode: search(q, k, m), args.k) for mode in modes
    }
    print(markdown_table(results, args.k))

    if args.show_misses:
        for mode, r in results.items():
            print(f"\nMisses ({mode}):")
            for q in r["questions"]:
                if q["rank"] is None:
                    print(f"  [{q.get('kind', '-')}] {q['question']}\n      got: {q['got'][:3]}")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out = RESULTS_DIR / f"retrieval-{datetime.now():%Y%m%d-%H%M%S}.json"
    out.write_text(json.dumps({"k": args.k, "results": results}, indent=2), encoding="utf-8")
    print(f"\nSaved {out}")


if __name__ == "__main__":
    main()
