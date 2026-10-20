"""Small HTTP client for the optional updater sidecar."""

from __future__ import annotations

from typing import Any

import httpx

from app.config import settings


class UpdaterError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def enabled() -> bool:
    return bool(settings.homst_updater_url)


def _client(timeout: float | httpx.Timeout = 5.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=settings.homst_updater_url.rstrip("/"),
        timeout=timeout,
        trust_env=False,
    )


async def get_target() -> dict[str, Any] | None:
    if not enabled():
        return None
    try:
        async with _client(3.0) as client:
            response = await client.get("/target")
            if response.status_code == 200:
                return response.json()
    except Exception:
        pass
    return None


async def get_status() -> dict[str, Any] | None:
    if not enabled():
        return None
    try:
        async with _client(3.0) as client:
            response = await client.get("/status")
            if response.status_code == 200:
                return response.json()
    except Exception:
        pass
    return None


async def install(version: str, latest: bool) -> dict[str, Any]:
    if not enabled():
        raise UpdaterError(503, "The updater service is not configured.")
    try:
        async with _client(10.0) as client:
            response = await client.post(
                "/install", json={"version": version, "latest": latest}
            )
    except Exception as exc:
        raise UpdaterError(503, f"Could not reach the updater service: {exc}") from exc

    if response.status_code >= 400:
        try:
            detail = response.json().get("detail") or response.text
        except Exception:
            detail = response.text
        raise UpdaterError(response.status_code, str(detail))
    return response.json()


async def retry_rollback() -> dict[str, Any]:
    if not enabled():
        raise UpdaterError(503, "The updater service is not configured.")
    try:
        async with _client(10.0) as client:
            response = await client.post("/recovery/retry-rollback")
    except Exception as exc:
        raise UpdaterError(503, f"Could not reach the updater service: {exc}") from exc

    if response.status_code >= 400:
        try:
            detail = response.json().get("detail") or response.text
        except Exception:
            detail = response.text
        raise UpdaterError(response.status_code, str(detail))
    return response.json()
