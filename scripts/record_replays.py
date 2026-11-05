"""Record real /ask/stream runs as replay files for the web frontend.

Replays let visitors without the password see complete answers, and give the UI
real data to develop against. Each file keeps every event with its time offset, so
the frontend can play a run back at its original pace.

Usage (API running locally with keys set):
    uvicorn rag.api:app --port 8000
    python scripts/record_replays.py [--api http://localhost:8000]
"""

import argparse
import json
import time
from pathlib import Path

import httpx

OUT_DIR = Path(__file__).parent.parent / "web" / "src" / "data" / "replays"

# (id, question): picked to show different behaviours, not just successes.
QUESTIONS = [
    ("signals-code", "How do I connect a signal in code?"),
    ("get-node-or-null", "What does get_node_or_null return?"),
    (
        "freeze-loading",
        "My game freezes for a few seconds when I switch to a big level. How do I stop that?",
    ),
    ("global-variable", "How do I keep the player's score when going from one level to the next?"),
    ("line-of-sight", "How can an enemy check if it can see the player without a wall in between?"),
    ("no-answer-steam", "How many Godot games were released on Steam last year?"),
]


def record(api: str, question: str, headers: dict[str, str]) -> list[dict]:
    events, name = [], None
    start = time.perf_counter()
    body = {"question": question, "mode": "hybrid"}
    with httpx.stream("POST", f"{api}/ask/stream", json=body, headers=headers, timeout=120) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if line.startswith("event: "):
                name = line.removeprefix("event: ")
            elif line.startswith("data: "):
                t = round((time.perf_counter() - start) * 1000)
                events.append({"t": t, "event": name, "data": json.loads(line[6:])})
    return events


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--api", default="http://localhost:8000")
    parser.add_argument("--key", default="", help="X-Internal-Key, if the API has one set")
    args = parser.parse_args()
    headers = {"X-Internal-Key": args.key} if args.key else {}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for replay_id, question in QUESTIONS:
        events = record(args.api, question, headers)
        replay = {"id": replay_id, "question": question, "mode": "hybrid", "events": events}
        path = OUT_DIR / f"{replay_id}.json"
        path.write_text(json.dumps(replay, indent=1) + "\n", encoding="utf-8")
        print(f"{replay_id}: {len(events)} events, {events[-1]['t']} ms -> {path.name}")


if __name__ == "__main__":
    main()
