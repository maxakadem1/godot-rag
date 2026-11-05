"""Vercel entrypoint, named in pyproject.toml under [tool.vercel].

Vercel installs the dependencies but not this project itself, so src/ is put on the
import path before importing the app. Locally, run `uvicorn rag.api:app` as before.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from rag.api import app

__all__ = ["app"]
