"""Vercel entrypoint: Vercel serves the `app` object from app.py at the project root.

Locally, run `uvicorn rag.api:app` as before.
"""

import sys
from pathlib import Path

try:
    from rag.api import app
except ModuleNotFoundError:  # the src/ package wasn't installed, only its dependencies
    sys.path.insert(0, str(Path(__file__).parent / "src"))
    from rag.api import app

__all__ = ["app"]
