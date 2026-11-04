"""CLI: fetch the Godot docs and write cleaned documents to data/documents.jsonl.

rag-ingest                       # clone/pull + parse everything
rag-ingest --no-fetch            # reuse the existing checkout
rag-ingest --skip-class-reference
"""

import argparse
import json
import time

from rag.config import settings
from rag.ingest.fetch import current_commit, fetch_godot_docs, list_rst_files
from rag.ingest.parse_rst import parse_rst

SOURCE = "godot-docs"


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        "--no-fetch", action="store_true", help="don't clone/pull, use existing checkout"
    )
    parser.add_argument(
        "--skip-class-reference", action="store_true", help="skip the auto-generated classes/ pages"
    )
    args = parser.parse_args()

    repo_dir = settings.docs_checkout_dir
    if not args.no_fetch:
        fetch_godot_docs(settings.godot_docs_repo, settings.godot_docs_branch, repo_dir)

    start = time.perf_counter()
    files = list_rst_files(repo_dir, include_class_reference=not args.skip_class_reference)
    written = skipped = sections = 0

    settings.documents_path.parent.mkdir(parents=True, exist_ok=True)
    with settings.documents_path.open("w", encoding="utf-8") as out:
        for path in files:
            rel = path.relative_to(repo_dir).as_posix()
            doc = parse_rst(SOURCE, rel, path.read_text(encoding="utf-8"), settings.docs_base_url)
            if doc is None:
                skipped += 1
                continue
            out.write(doc.model_dump_json() + "\n")
            written += 1
            sections += len(doc.sections)

    summary = {
        "commit": current_commit(repo_dir),
        "files": len(files),
        "documents_written": written,
        "skipped_empty": skipped,
        "sections": sections,
        "output": str(settings.documents_path),
        "seconds": round(time.perf_counter() - start, 1),
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
