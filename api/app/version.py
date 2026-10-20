"""Application version/build metadata.

Release images bake the version and commit into ``/app/VERSION`` and
``/app/COMMIT`` at build time.  Reading files (instead of only env vars)
means a recreated container always reports the version of the image it is
actually running — even if an old container spec was cloned during an
update.
"""

from __future__ import annotations

import os
from pathlib import Path

_VERSION_FILE = Path(os.environ.get("HOMST_VERSION_FILE", "/app/VERSION"))
_COMMIT_FILE = Path(os.environ.get("HOMST_COMMIT_FILE", "/app/COMMIT"))


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


VERSION = _read(_VERSION_FILE) or os.environ.get("HOMST_VERSION", "dev") or "dev"
COMMIT = _read(_COMMIT_FILE) or os.environ.get("HOMST_COMMIT", "") or ""
