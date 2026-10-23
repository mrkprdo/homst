"""Coverage for updater HTTP clients, release caching, and system routes."""

import json
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app import updater_client
from app.config import settings
from app.routers import system as system_router
from app.updater.spec import _binds_from_mounts, _normalized, _override, merge_container_spec
from app.updates import ReleaseFeed, _feed_from_cache, mature_releases, parse_release

# ══════════════════════════════════════════════════════════════════════
# updater_client
# ══════════════════════════════════════════════════════════════════════


class _Response:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class _Client:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, path):
        self.calls.append(("GET", path))
        if self.error:
            raise self.error
        return self.response

    async def post(self, path, json=None):
        self.calls.append(("POST", path, json))
        if self.error:
            raise self.error
        return self.response


def _patch_client(monkeypatch, response=None, error=None):
    holder = _Client(response, error)

    def factory(_timeout=None):
        return holder

    monkeypatch.setattr(updater_client, "_client", factory)
    monkeypatch.setattr(settings, "homst_updater_url", "http://updater:9000")
    return holder


@pytest.mark.asyncio
async def test_updater_client_disabled_paths(monkeypatch):
    monkeypatch.setattr(settings, "homst_updater_url", "")
    assert updater_client.enabled() is False
    assert await updater_client.get_target() is None
    assert await updater_client.get_status() is None
    with pytest.raises(updater_client.UpdaterError) as exc:
        await updater_client.install("0.3.0", latest=True)
    assert exc.value.status_code == 503
    with pytest.raises(updater_client.UpdaterError):
        await updater_client.retry_rollback()


@pytest.mark.asyncio
async def test_updater_client_reads_target_and_status(monkeypatch):
    _patch_client(monkeypatch, _Response(200, {"image": "x"}))
    assert await updater_client.get_target() == {"image": "x"}
    assert await updater_client.get_status() == {"image": "x"}

    _patch_client(monkeypatch, _Response(500, {"detail": "no"}))
    assert await updater_client.get_target() is None
    assert await updater_client.get_status() is None

    _patch_client(monkeypatch, error=RuntimeError("offline"))
    assert await updater_client.get_target() is None
    assert await updater_client.get_status() is None


@pytest.mark.asyncio
async def test_updater_client_install_and_retry_errors(monkeypatch):
    _patch_client(monkeypatch, error=RuntimeError("offline"))
    with pytest.raises(updater_client.UpdaterError) as exc:
        await updater_client.install("0.3.0", latest=False)
    assert "Could not reach" in exc.value.detail
    with pytest.raises(updater_client.UpdaterError):
        await updater_client.retry_rollback()

    _patch_client(monkeypatch, _Response(409, {"detail": "busy"}))
    with pytest.raises(updater_client.UpdaterError) as exc:
        await updater_client.install("0.3.0", latest=False)
    assert (exc.value.status_code, exc.value.detail) == (409, "busy")
    with pytest.raises(updater_client.UpdaterError) as exc:
        await updater_client.retry_rollback()
    assert (exc.value.status_code, exc.value.detail) == (409, "busy")

    # A body that is not JSON falls back to the raw text.
    _patch_client(monkeypatch, _Response(500, ValueError("bad json"), text="gateway"))
    with pytest.raises(updater_client.UpdaterError) as exc:
        await updater_client.install("0.3.0", latest=False)
    assert exc.value.detail == "gateway"

    _patch_client(monkeypatch, _Response(202, {"id": "job-1"}))
    assert await updater_client.install("0.3.0", latest=True) == {"id": "job-1"}
    assert await updater_client.retry_rollback() == {"id": "job-1"}


# ══════════════════════════════════════════════════════════════════════
# updates: parsing + cache + network branches
# ══════════════════════════════════════════════════════════════════════


class _FeedResponse:
    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _FeedClient:
    shared = None

    def __init__(self, *_args, **_kwargs):
        self.response = _FeedClient.shared

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, params=None, headers=None):
        assert url.startswith("https://api.github.com/")
        assert params == {"per_page": 30}
        assert headers["User-Agent"].startswith("HOMST/")
        _FeedClient.last_headers = headers
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def _patch_feed(monkeypatch, cached, response):
    from app import updates

    saved = {}

    async def load():
        return cached

    async def save(payload):
        saved.update(payload)

    monkeypatch.setattr(updates, "_load_cache", load)
    monkeypatch.setattr(updates, "_save_cache", save)
    monkeypatch.setattr(updates.httpx, "AsyncClient", _FeedClient)
    _FeedClient.shared = response
    _FeedClient.last_headers = None
    if hasattr(updates._FETCH_LOCK, "_locked"):
        # The real lock is not held between tests; only a lock instance can be
        # replaced, so callers never assign here.
        pass
    return saved


@pytest.mark.asyncio
async def test_fetch_releases_returns_fresh_and_forced_cache(monkeypatch):
    from app import updates

    cached = {
        "releases": [],
        "checked_at": time.time(),
        "etag": "abc",
    }
    _patch_feed(monkeypatch, cached, RuntimeError("should not fetch"))
    feed = await updates.fetch_releases()
    assert feed.releases == []

    feed = await updates.fetch_releases(force=True)
    assert feed.releases == []
    assert _FeedClient.last_headers is None


@pytest.mark.asyncio
async def test_fetch_releases_skips_when_another_refresh_is_running(monkeypatch):
    from app import updates

    cached = {"releases": [], "checked_at": time.time()}
    _patch_feed(monkeypatch, cached, RuntimeError("should not fetch"))

    class Locked:
        def locked(self):
            return True

    monkeypatch.setattr(updates, "_FETCH_LOCK", Locked())
    feed = await updates.fetch_releases(force=True)
    assert feed.releases == []


@pytest.mark.asyncio
async def test_fetch_releases_304_and_rate_limit_and_success(monkeypatch):
    from app import updates

    cached = {
        "releases": [
            {
                "version": "0.2.0",
                "tag": "0.2.0",
                "published_at": "2020-01-01T00:00:00Z",
            }
        ],
        "checked_at": 0,
        "etag": "etag-1",
    }
    _patch_feed(
        monkeypatch,
        cached,
        _FeedResponse(304),
    )
    feed = await updates.fetch_releases(force=True)
    assert [r["version"] for r in feed.releases] == ["0.2.0"]
    assert _FeedClient.last_headers["If-None-Match"] == "etag-1"

    _patch_feed(
        monkeypatch,
        cached,
        _FeedResponse(403, {"message": "limited"}, {"x-ratelimit-remaining": "0"}),
    )
    feed = await updates.fetch_releases(force=True)
    assert feed.stale is True
    assert "rate limit" in feed.error.lower()

    _patch_feed(
        monkeypatch,
        None,
        _FeedResponse(403, {"message": "limited"}, {"x-ratelimit-remaining": "0"}),
    )
    feed = await updates.fetch_releases(force=True)
    assert feed.releases == [] and "rate limit" in feed.error.lower()

    saved = _patch_feed(
        monkeypatch,
        None,
        _FeedResponse(
            200,
            [
                {
                    "tag_name": "v0.3.0",
                    "draft": False,
                    "prerelease": False,
                    "name": "Three",
                    "published_at": "2020-01-01T00:00:00Z",
                    "html_url": "https://example.com",
                    "body": "notes",
                }
            ],
            {"etag": "etag-2"},
        ),
    )
    feed = await updates.fetch_releases(force=True)
    assert [r["version"] for r in feed.releases] == ["0.3.0"]
    assert saved["etag"] == "etag-2"


@pytest.mark.asyncio
async def test_fetch_releases_network_failures(monkeypatch):
    from app import updates

    cached = {"releases": [], "checked_at": 0}
    _patch_feed(monkeypatch, cached, RuntimeError("network down"))
    feed = await updates.fetch_releases(force=True)
    assert feed.stale is True
    assert "network down" in feed.error

    _patch_feed(monkeypatch, None, RuntimeError("network down"))
    feed = await updates.fetch_releases(force=True)
    assert feed.releases == []
    assert "Could not reach GitHub" in feed.error


@pytest.mark.asyncio
async def test_load_and_save_cache_fall_back_to_memory(monkeypatch):
    from app import updates

    async def boom():
        raise RuntimeError("redis offline")

    monkeypatch.setattr(updates, "get_redis", boom)
    monkeypatch.setattr(updates, "_MEM_CACHE", None)
    monkeypatch.setattr(updates, "_MEM_CACHE_AT", 0.0)
    assert await updates._load_cache() is None

    await updates._save_cache({"releases": []})
    assert (await updates._load_cache()) == {"releases": []}

    # Expired memory cache is ignored.
    monkeypatch.setattr(updates, "_MEM_CACHE_AT", 0.0)
    monkeypatch.setattr(updates, "_MEM_CACHE", {"stale": True})
    assert await updates._load_cache() is None


@pytest.mark.asyncio
async def test_load_cache_reads_redis_json(monkeypatch):
    from app import updates

    class Redis:
        async def get(self, _key):
            return json.dumps({"releases": [], "checked_at": 1})

    async def get_redis():
        return Redis()

    monkeypatch.setattr(updates, "get_redis", get_redis)
    assert await updates._load_cache() == {"releases": [], "checked_at": 1}

    class BadRedis:
        async def get(self, _key):
            return "not json"

    async def bad_get_redis():
        return BadRedis()

    monkeypatch.setattr(updates, "get_redis", bad_get_redis)
    assert await updates._load_cache() is None


def test_release_parsing_edge_cases():
    assert parse_release({"tag_name": ""}) is None
    assert parse_release({"tag_name": "v1.2.3", "name": None})["name"] == "1.2.3"
    assert parse_release({"tag_name": "v1.2.3", "body": None})["notes"] == ""

    # A timestamp without an offset is treated as UTC.
    older = mature_releases(
        [{"version": "1.0.0", "published_at": "2020-01-01T00:00:00"}],
        now=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    assert older

    feed = _feed_from_cache({})
    assert feed.releases == [] and feed.checked_at == 0.0
    assert ReleaseFeed().latest is None


# ══════════════════════════════════════════════════════════════════════
# updater/spec edge cases
# ══════════════════════════════════════════════════════════════════════


def test_spec_normalization_and_bind_fallbacks():
    assert _normalized([1, 2]) == (1, 2)
    assert _normalized({"b": 1, "a": 2}) == '{"a": 2, "b": 1}'
    assert _normalized("x") == "x"

    old = {"Cmd": ["same"]}
    assert _override(old, {"Cmd": ["same"]}, "Cmd") is None
    assert _override(old, {"Cmd": ["different"]}, "Cmd") == ["same"]
    assert _override({}, {}, "Cmd") is None

    assert _binds_from_mounts(None) == []
    assert _binds_from_mounts(
        [
            {"Type": "volume", "Name": "vol", "Destination": "/data", "RW": False},
            {"Type": "bind", "Source": "/src", "Destination": "/dst"},
            {"Type": "volume", "Destination": "/no-source"},
        ]
    ) == ["vol:/data:ro", "/src:/dst"]


def test_spec_keeps_custom_hostname_and_skips_empty_volumes():
    old_container = {
        "Id": "abcdef1234567890",
        "Config": {
            "Hostname": "custom-host",
            "Image": "ghcr.io/mrkprdo/homst:latest",
            "Env": [],
            "ExposedPorts": {"8443/tcp": {}},
        },
        "HostConfig": {"NetworkMode": "host"},
        "Mounts": [{"Type": "bind", "Source": "/src", "Destination": "/dst", "RW": False}],
        "NetworkSettings": {"Networks": {}},
    }
    payload = merge_container_spec(
        old_container,
        {},
        {"Config": {}},
        "ghcr.io/mrkprdo/homst:0.3.0",
        "0.3.0",
    )
    assert payload["Hostname"] == "custom-host"
    assert payload["HostConfig"]["Binds"] == ["/src:/dst:ro"]
    assert "Volumes" not in payload
    assert "NetworkingConfig" not in payload


# ══════════════════════════════════════════════════════════════════════
# workers
# ══════════════════════════════════════════════════════════════════════


class _Result:
    def __init__(self, household):
        self.household = household

    def scalar_one_or_none(self):
        return self.household


class _SessionCtx:
    def __init__(self, household):
        self.household = household
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, _stmt):
        return _Result(self.household)

    async def commit(self):
        self.commits += 1


@pytest.mark.asyncio
async def test_check_auto_update_exits_on_every_guard(monkeypatch):
    from app.workers import settings as worker

    monkeypatch.setattr(worker.updater_client, "enabled", lambda: False)
    await worker.check_auto_update(None)

    monkeypatch.setattr(worker.updater_client, "enabled", lambda: True)

    household = SimpleNamespace(settings={"updates": {"enabled": False}})
    monkeypatch.setattr(worker, "async_session", lambda: _SessionCtx(household))
    await worker.check_auto_update(None)

    household.settings = {"updates": {"enabled": True}}
    monkeypatch.setattr(worker, "_check_due", lambda _minutes: False)
    await worker.check_auto_update(None)

    monkeypatch.setattr(worker, "_check_due", lambda _minutes: True)

    async def no_target():
        return None

    monkeypatch.setattr(worker.updater_client, "get_target", no_target)
    await worker.check_auto_update(None)

    async def custom_target():
        return {"image": "ghcr.io/other/app:latest"}

    monkeypatch.setattr(worker.updater_client, "get_target", custom_target)
    await worker.check_auto_update(None)

    async def good_target():
        return {"image": "ghcr.io/mrkprdo/homst:latest"}

    monkeypatch.setattr(worker.updater_client, "get_target", good_target)

    async def empty_feed(force=False):
        return ReleaseFeed()

    monkeypatch.setattr(worker, "fetch_releases", empty_feed)
    await worker.check_auto_update(None)

    async def same_feed(force=False):
        return ReleaseFeed(releases=[{"version": worker.VERSION}])

    monkeypatch.setattr(worker, "fetch_releases", same_feed)
    await worker.check_auto_update(None)


@pytest.mark.asyncio
async def test_check_auto_update_publishes_and_swallows_errors(monkeypatch, capsys):
    from app.workers import settings as worker

    monkeypatch.setattr(worker.updater_client, "enabled", lambda: True)
    monkeypatch.setattr(worker, "_check_due", lambda _minutes: True)
    household = SimpleNamespace(settings={"updates": {"enabled": True}})
    monkeypatch.setattr(worker, "async_session", lambda: _SessionCtx(household))
    monkeypatch.setattr(worker, "VERSION", "0.2.0")

    async def target():
        return {"image": "ghcr.io/mrkprdo/homst:latest"}

    async def feed(force=False):
        return ReleaseFeed(releases=[{"version": "0.3.0", "html_url": "https://x"}])

    async def status():
        return {"held_version": "0.1.0", "job": None}

    async def boom(*_args, **_kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr(worker.updater_client, "get_target", target)
    monkeypatch.setattr(worker.updater_client, "get_status", status)
    monkeypatch.setattr(worker, "fetch_releases", feed)
    monkeypatch.setattr(worker, "publish_event", boom)

    await worker.check_auto_update(None)
    assert "update available: 0.3.0" in capsys.readouterr().out


@pytest.mark.asyncio
async def test_auto_theme_swallows_publish_errors(monkeypatch):
    from app.workers import settings as worker

    household = SimpleNamespace(
        settings={
            "theme": "auto",
            "lat": 43.7,
            "lon": -79.4,
            "timezone": "America/Toronto",
            "autoThemeDark": True,
        }
    )
    monkeypatch.setattr(worker, "async_session", lambda: _SessionCtx(household))

    async def boom(*_args, **_kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr(worker, "publish_event", boom)
    await worker.apply_auto_theme(None, now=datetime(2026, 10, 21, 16, 0, tzinfo=timezone.utc))
    assert household.settings["autoThemeDark"] is False


# ══════════════════════════════════════════════════════════════════════
# routers/system remaining branches
# ══════════════════════════════════════════════════════════════════════


def _feed(version="0.3.0"):
    return ReleaseFeed(
        releases=[
            {
                "version": version,
                "tag": version,
                "name": version,
                "published_at": "2020-01-01T00:00:00Z",
                "html_url": "https://example.com",
                "notes": "",
            }
        ],
        checked_at=time.time(),
    )


def _patch_system(monkeypatch, *, target, status, feed, managed=None):
    async def fake_fetch(force=False):
        return feed

    async def fake_target():
        return target

    async def fake_status():
        return status

    monkeypatch.setattr(system_router, "VERSION", "0.2.0")
    monkeypatch.setattr(system_router, "fetch_releases", fake_fetch)
    monkeypatch.setattr(system_router.updater_client, "get_target", fake_target)
    monkeypatch.setattr(system_router.updater_client, "get_status", fake_status)
    if managed is not None:
        monkeypatch.setattr(system_router, "is_managed", lambda *_a, **_k: managed)


@pytest.mark.asyncio
async def test_system_status_sets_reason_when_managed_has_none(client, monkeypatch):
    _patch_system(
        monkeypatch,
        target=None,
        status=None,
        feed=_feed(),
        managed=(False, None),
    )
    r = await client.get("/api/v1/system/status")
    assert r.status_code == 200
    assert r.json()["self_update"]["reason"] == "The updater service is not running."


@pytest.mark.asyncio
async def test_system_status_nightly_without_target(client, monkeypatch):
    _patch_system(monkeypatch, target=None, status=None, feed=_feed())
    monkeypatch.setattr(system_router, "VERSION", "dev")
    r = await client.get("/api/v1/system/status")
    assert r.json()["current"]["channel"] == "nightly"


@pytest.mark.asyncio
async def test_update_job_returns_503_when_updater_is_down(client, monkeypatch):
    async def none():
        return None

    monkeypatch.setattr(system_router.updater_client, "get_status", none)
    r = await client.get("/api/v1/system/job")
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_install_rejects_unavailable_unmanaged_and_empty_feed(client, monkeypatch):
    headers = {"X-HOMST-Update": "1"}

    _patch_system(monkeypatch, target=None, status=None, feed=_feed())
    r = await client.post("/api/v1/system/install", json={"version": "0.3.0"}, headers=headers)
    assert r.status_code == 503

    _patch_system(
        monkeypatch,
        target={"image": "ghcr.io/other/app:latest"},
        status=None,
        feed=_feed(),
    )
    r = await client.post("/api/v1/system/install", json={"version": "0.3.0"}, headers=headers)
    assert r.status_code == 409

    _patch_system(monkeypatch, target=None, status=None, feed=ReleaseFeed())
    r = await client.post("/api/v1/system/install", json={"version": "0.3.0"}, headers=headers)
    assert r.status_code == 503


@pytest.mark.asyncio
async def test_install_rejects_current_version_and_surfaces_updater_error(
    client, monkeypatch
):
    headers = {"X-HOMST-Update": "1"}
    _patch_system(
        monkeypatch,
        target={"image": "ghcr.io/mrkprdo/homst:latest"},
        status={"job": None},
        feed=ReleaseFeed(
            releases=[
                {
                    "version": "0.3.0",
                    "tag": "0.3.0",
                    "name": "0.3.0",
                    "published_at": "2020-01-01T00:00:00Z",
                    "html_url": "https://example.com",
                    "notes": "",
                },
                {
                    "version": "0.2.0",
                    "tag": "0.2.0",
                    "name": "0.2.0",
                    "published_at": "2020-01-01T00:00:00Z",
                    "html_url": "https://example.com",
                    "notes": "",
                },
            ],
            checked_at=time.time(),
        ),
    )
    r = await client.post("/api/v1/system/install", json={"version": "0.2.0"}, headers=headers)
    assert r.status_code == 409

    async def boom(*_args, **_kwargs):
        raise updater_client.UpdaterError(409, "busy")

    monkeypatch.setattr(system_router.updater_client, "install", boom)
    r = await client.post("/api/v1/system/install", json={"version": "0.3.0"}, headers=headers)
    assert r.status_code == 409

    async def fake_install(*_args, **_kwargs):
        return {"id": "job-2"}

    async def bad_publish(*_args, **_kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr(system_router.updater_client, "install", fake_install)
    monkeypatch.setattr(system_router, "publish_event", bad_publish)
    r = await client.post("/api/v1/system/install", json={"version": "0.3.0"}, headers=headers)
    assert r.status_code == 202


@pytest.mark.asyncio
async def test_dismiss_creates_household_and_ignores_publish_error(client, monkeypatch):
    async def boom(*_args, **_kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr(system_router, "publish_event", boom)
    r = await client.post(
        "/api/v1/system/prompt/dismiss",
        json={"version": "0.3.0"},
        headers={"X-HOMST-Update": "1"},
    )
    assert r.status_code == 200
    assert r.json() == {"dismissed": "0.3.0"}


@pytest.mark.asyncio
async def test_retry_rollback_success_and_error(client, monkeypatch):
    async def ok():
        return {"message": "retried"}

    monkeypatch.setattr(system_router.updater_client, "retry_rollback", ok)
    r = await client.post(
        "/api/v1/system/recovery/retry-rollback",
        headers={"X-HOMST-Update": "1"},
    )
    assert r.status_code == 200

    async def boom():
        raise updater_client.UpdaterError(500, "nope")

    monkeypatch.setattr(system_router.updater_client, "retry_rollback", boom)
    r = await client.post(
        "/api/v1/system/recovery/retry-rollback",
        headers={"X-HOMST-Update": "1"},
    )
    assert r.status_code == 500
    assert r.json()["detail"] == "nope"

    with pytest.raises(HTTPException):
        system_router._require_update_header(SimpleNamespace(headers={}))


@pytest.mark.asyncio
async def test_update_job_returns_status_when_available(client, monkeypatch):
    async def status():
        return {"job": {"state": "queued"}}

    monkeypatch.setattr(system_router.updater_client, "get_status", status)
    r = await client.get("/api/v1/system/job")
    assert r.status_code == 200
    assert r.json()["job"]["state"] == "queued"


@pytest.mark.asyncio
async def test_install_reports_empty_release_feed_with_a_managed_target(client, monkeypatch):
    _patch_system(
        monkeypatch,
        target={"image": "ghcr.io/mrkprdo/homst:latest"},
        status={"job": None},
        feed=ReleaseFeed(),
    )
    r = await client.post(
        "/api/v1/system/install",
        json={"version": "0.3.0"},
        headers={"X-HOMST-Update": "1"},
    )
    assert r.status_code == 503
    assert "verify the official release list" in r.json()["detail"]


def test_parse_version_ignores_empty_values():
    from app.system_state import parse_version

    assert parse_version("") is None
    assert parse_version(None) is None
    assert str(parse_version("v1.2.3")) == "1.2.3"


def test_spec_copies_ipam_config():
    old_container = {
        "Id": "abcdef123456",
        "Config": {"Image": "ghcr.io/mrkprdo/homst:latest", "Env": []},
        "HostConfig": {"NetworkMode": "homst_default"},
        "NetworkSettings": {
            "Networks": {
                "homst_default": {
                    "Aliases": ["homst", "abcdef123456"],
                    "IPAMConfig": {"IPv4Address": "172.18.0.5"},
                }
            }
        },
    }
    payload = merge_container_spec(
        old_container, {}, {"Config": {}}, "ghcr.io/mrkprdo/homst:0.3.0", "0.3.0"
    )
    assert payload["NetworkingConfig"]["EndpointsConfig"]["homst_default"] == {
        "Aliases": ["homst"],
        "IPAMConfig": {"IPv4Address": "172.18.0.5"},
    }


def test_updater_client_builds_a_real_async_client(monkeypatch):
    import httpx

    seen = {}

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            seen.update(kwargs)

        async def aclose(self):
            pass

    monkeypatch.setattr(httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(settings, "homst_updater_url", "http://updater:9000/")
    client = updater_client._client(7.0)
    assert isinstance(client, FakeAsyncClient)
    assert seen["base_url"] == "http://updater:9000"
    assert seen["timeout"] == 7.0


@pytest.mark.asyncio
async def test_updater_client_retry_rollback_text_error(monkeypatch):
    _patch_client(monkeypatch, _Response(502, ValueError("not json"), text="bad gateway"))
    with pytest.raises(updater_client.UpdaterError) as exc:
        await updater_client.retry_rollback()
    assert exc.value.detail == "bad gateway"


@pytest.mark.asyncio
async def test_save_cache_writes_redis_when_available(monkeypatch):
    from app import updates

    written = {}

    class Redis:
        async def setex(self, key, ttl, value):
            written["key"] = key
            written["ttl"] = ttl
            written["value"] = value

    async def get_redis():
        return Redis()

    monkeypatch.setattr(updates, "get_redis", get_redis)
    await updates._save_cache({"releases": [], "checked_at": 1})
    assert written["key"] == updates.CACHE_KEY
    assert json.loads(written["value"])["checked_at"] == 1


@pytest.mark.asyncio
async def test_fetch_releases_returns_cached_when_lock_is_held(monkeypatch):
    from app import updates

    cached = {"releases": [], "checked_at": 0}
    _patch_feed(monkeypatch, cached, RuntimeError("should not fetch"))

    class Locked:
        def locked(self):
            return True

    monkeypatch.setattr(updates, "_FETCH_LOCK", Locked())
    feed = await updates.fetch_releases(force=True)
    assert feed.releases == []


@pytest.mark.asyncio
async def test_fetch_releases_rechecks_cache_after_acquiring_the_lock(monkeypatch):
    from app import updates

    stale = {"releases": [], "checked_at": 0}
    fresh = {"releases": [], "checked_at": time.time()}
    calls = {"n": 0}

    async def load():
        calls["n"] += 1
        return stale if calls["n"] == 1 else fresh

    async def save(_payload):
        raise AssertionError("must not fetch")

    monkeypatch.setattr(updates, "_load_cache", load)
    monkeypatch.setattr(updates, "_save_cache", save)
    monkeypatch.setattr(updates.httpx, "AsyncClient", _FeedClient)
    _FeedClient.shared = RuntimeError("should not fetch")

    feed = await updates.fetch_releases(force=True)
    assert feed.releases == []
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_check_auto_update_stops_when_the_feed_is_empty(monkeypatch):
    from app.workers import settings as worker

    monkeypatch.setattr(worker.updater_client, "enabled", lambda: True)
    monkeypatch.setattr(worker, "_check_due", lambda _minutes: True)
    monkeypatch.setattr(worker, "is_managed", lambda *_a, **_k: (True, None))
    monkeypatch.setattr(
        worker,
        "async_session",
        lambda: _SessionCtx(SimpleNamespace(settings={"updates": {"enabled": True}})),
    )

    async def target():
        return {"image": "ghcr.io/mrkprdo/homst:latest"}

    async def empty(force=False):
        return ReleaseFeed()

    monkeypatch.setattr(worker.updater_client, "get_target", target)
    monkeypatch.setattr(worker, "fetch_releases", empty)
    await worker.check_auto_update(None)


def test_docker_client_constructor_uses_the_unix_socket(monkeypatch):
    from app.updater import docker_api

    seen = {}

    class Transport:
        def __init__(self, uds):
            seen["uds"] = uds

    class Client:
        def __init__(self, **kwargs):
            seen.update(kwargs)

    monkeypatch.setattr(docker_api.httpx, "AsyncHTTPTransport", Transport)
    monkeypatch.setattr(docker_api.httpx, "AsyncClient", Client)
    docker_api.DockerClient("/var/run/docker.sock")
    assert seen["uds"] == "/var/run/docker.sock"
    assert seen["base_url"] == "http://docker"
