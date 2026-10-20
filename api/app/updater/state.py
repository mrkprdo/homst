"""Atomic JSON persistence for the updater sidecar."""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger("homst.updater.state")


def default_state() -> dict[str, Any]:
    return {
        "current_version": None,
        "previous_version": None,
        "previous_image": None,
        "held_version": None,
        "held_reason": None,
        "history": [],
        "last_job": None,
        "updated_at": None,
    }


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except Exception as exc:
        logger.warning("Could not read %s: %s", path, exc)
        return None


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(temp, path)


class StateStore:
    def __init__(self, directory: str):
        self.directory = Path(directory)
        self.state_path = self.directory / "state.json"
        self.journal_path = self.directory / "journal.json"
        self._lock = asyncio.Lock()
        self._state = _read_json(self.state_path) or default_state()
        self._journal = _read_json(self.journal_path)

    async def snapshot(self) -> dict[str, Any]:
        async with self._lock:
            return copy.deepcopy(self._state)

    async def update(self, **changes: Any) -> dict[str, Any]:
        async with self._lock:
            self._state.update(changes)
            if "updated_at" not in changes:
                from datetime import datetime, timezone

                self._state["updated_at"] = datetime.now(timezone.utc).isoformat()
            _write_json(self.state_path, self._state)
            return copy.deepcopy(self._state)

    async def journal(self) -> dict[str, Any] | None:
        async with self._lock:
            return copy.deepcopy(self._journal)

    async def write_journal(self, journal: dict[str, Any]) -> None:
        async with self._lock:
            self._journal = copy.deepcopy(journal)
            _write_json(self.journal_path, self._journal)

    async def clear_journal(self) -> None:
        async with self._lock:
            self._journal = None
            try:
                self.journal_path.unlink()
            except FileNotFoundError:
                pass
