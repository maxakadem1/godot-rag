"""Fetch the Godot docs source (a git repo of reStructuredText files)."""

import subprocess
from pathlib import Path


def fetch_godot_docs(repo_url: str, branch: str, dest: Path) -> Path:
    """Shallow-clone the docs repo, or pull the latest changes if it already exists."""
    if (dest / ".git").exists():
        subprocess.run(
            ["git", "-C", str(dest), "fetch", "--depth", "1", "origin", branch], check=True
        )
        # FETCH_HEAD, not origin/<branch>: a single-branch clone only tracks the branch
        # it was cloned with, so origin/<branch> may not exist if the setting changed.
        subprocess.run(["git", "-C", str(dest), "reset", "--hard", "FETCH_HEAD"], check=True)
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", branch, repo_url, str(dest)], check=True
        )
    return dest


def current_commit(repo_dir: Path) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo_dir), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def list_rst_files(repo_dir: Path, include_class_reference: bool = True) -> list[Path]:
    """All .rst pages, skipping Sphinx internals (folders starting with '_')."""
    files = []
    for path in sorted(repo_dir.rglob("*.rst")):
        rel = path.relative_to(repo_dir)
        if any(part.startswith((".", "_")) for part in rel.parts):
            continue
        if not include_class_reference and rel.parts[0] == "classes":
            continue
        files.append(path)
    return files
