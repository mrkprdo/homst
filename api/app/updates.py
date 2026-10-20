"""Stable release discovery via GitHub Releases, cached in Redis.

Only official, non-prerelease releases are returned.  The cache is shared by
all gunicorn workers when Redis is available and falls back to process memory
otherwise (useful for tests and dev).
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
from packaging.version import InvalidVersion, Version

from app.redis_client import get_redis
from app.version import VERSION

CACHE_KEY = "homst:system:releases:v1"
CACHE_TTL = 900  # 15 minutes
CACHE_MAX_AGE = 86400
FORCE_MIN_INTERVAL = 60
RELEASES_URL = "https://api.github.com/repos/mrkprdo/homst/releases"

_MEM_CACHE: dict[str, Any] | None = None
_MEM_CACHE_AT = 0.0
_FETCH_LOCK = asyncio.Lock()


@dataclass
class ReleaseFeed:
    releases: list[dict[str, Any]] = field(default_factory=list)
    checked_at: float = 0.0
    stale: bool = False
    error: str | None = None

    @property
    def latest(self) -> dict[str, Any] | None:
        return self.releases[0] if self.releases else None


def _release_url() -> str:
    return RELEASES_URL


def parse_release(raw: dict[str, Any]) -> dict[str, Any] | None:
    tag = str(raw.get("tag_name") or "").strip()
    if tag.lower().startswith("v"):
        tag = tag[1:]
    if not tag:
        return None
    try:
        version = Version(tag)
    except InvalidVersion:
        return None
    if raw.get("draft") or raw.get("prerelease") or version.is_prerelease:
        return None
    return {
        "version": str(version),
        "tag": tag,
        "name": str(raw.get("name") or tag),
        "published_at": raw.get("published_at"),
        "html_url": raw.get("html_url"),
        "notes": str(raw.get("body") or "")[:4000],
    }


def parse_releases(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    releases = [release for item in raw if (release := parse_release(item))]
    releases.sort(key=lambda item: Version(item["version"]), reverse=True)
    return releases


def _feed_from_cache(cached: dict[str, Any]) -> ReleaseFeed:
    return ReleaseFeed(
        releases=list(cached.get("releases") or []),
        checked_at=float(cached.get("checked_at") or 0.0),
    )


async def _load_cache() -> dict[str, Any] | None:
    global _MEM_CACHE, _MEM_CACHE_AT
    try:
        redis = await get_redis()
        raw = await redis.get(CACHE_KEY)
        if raw:
            data = json.loads(raw)
            if isinstance(data, dict):
                return data
    except Exception:
        pass

    if _MEM_CACHE is not None and time.time() - _MEM_CACHE_AT < CACHE_MAX_AGE:
        return _MEM_CACHE
    return None


async def _save_cache(payload: dict[str, Any]) -> None:
    global _MEM_CACHE, _MEM_CACHE_AT
    _MEM_CACHE = payload
    _MEM_CACHE_AT = time.time()
    try:
        redis = await get_redis()
        await redis.setex(CACHE_KEY, CACHE_MAX_AGE, json.dumps(payload))
    except Exception:
        pass


async def fetch_releases(force: bool = False) -> ReleaseFeed:
    """Return the current stable release feed.

    ``force`` bypasses the normal TTL but is itself rate-limited so a few
    clicks cannot exhaust GitHub's unauthenticated API quota.
    """

    global _FETCH_LOCK

    cached = await _load_cache()
    cached_feed = _feed_from_cache(cached) if cached else None
    now = time.time()

    if cached and not force and now - cached_feed.checked_at < CACHE_TTL:
        return cached_feed
    if cached and force and now - cached_feed.checked_at < FORCE_MIN_INTERVAL:
        return cached_feed

    if _FETCH_LOCK.locked() and cached_feed:
        return cached_feed
    async with _FETCH_LOCK:
        # Another worker may have refreshed while we waited.
        cached = await _load_cache()
        if cached:
            cached_feed = _feed_from_cache(cached)
            age = time.time() - cached_feed.checked_at
            if age < FORCE_MIN_INTERVAL or (not force and age < CACHE_TTL):
                return cached_feed

        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": f"HOMST/{VERSION}",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if cached and cached.get("etag"):
            headers["If-None-Match"] = str(cached["etag"])

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(
                    _release_url(), params={"per_page": 30}, headers=headers
                )

            if response.status_code == 304 and cached:
                payload = {
                    "releases": cached.get("releases") or [],
                    "checked_at": time.time(),
                    "etag": cached.get("etag"),
                }
                await _save_cache(payload)
                return _feed_from_cache(payload)

            if response.status_code == 403 and response.headers.get(
                "x-ratelimit-remaining"
            ) == "0":
                if cached_feed:
                    cached_feed.stale = True
                    cached_feed.error = "GitHub API rate limit reached. Showing cached releases."
                    return cached_feed
                return ReleaseFeed(error="GitHub API rate limit reached. Try again later.")

            response.raise_for_status()
            releases = parse_releases(response.json())
            payload = {
                "releases": releases,
                "checked_at": time.time(),
                "etag": response.headers.get("etag"),
            }
            await _save_cache(payload)
            return _feed_from_cache(payload)
        except Exception as exc:  # network errors, bad JSON, rate limits
            if cached_feed:
                cached_feed.stale = True
                cached_feed.error = f"Could not refresh releases: {exc}"
                return cached_feed
            return ReleaseFeed(error=f"Could not reach GitHub: {exc}")
