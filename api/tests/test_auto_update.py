import time
from types import SimpleNamespace

import pytest

from app.updates import ReleaseFeed
from app.workers import settings as worker


class FakeResult:
    def __init__(self, household):
        self.household = household

    def scalar_one_or_none(self):
        return self.household


class FakeSession:
    def __init__(self, household):
        self.household = household

    async def execute(self, _stmt):
        return FakeResult(self.household)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


class FakeRedis:
    async def set(self, *args, **kwargs):
        return True


def _feed(version="0.3.0"):
    return ReleaseFeed(
        releases=[
            {
                "version": version,
                "tag": version,
                "name": version,
                "published_at": "2026-10-01T00:00:00Z",
                "html_url": "https://example.com",
                "notes": "",
            }
        ],
        checked_at=time.time(),
    )


def _household(settings):
    return SimpleNamespace(settings=settings)


def _patch_common(monkeypatch, household_settings, version="0.2.0"):
    monkeypatch.setattr(worker.updater_client, "enabled", lambda: True)
    monkeypatch.setattr(
        worker,
        "async_session",
        lambda: FakeSession(_household(household_settings)),
    )
    monkeypatch.setattr(worker, "VERSION", version)
    monkeypatch.setattr(worker, "update_window_open", lambda *args: True)
    monkeypatch.setattr(
        worker.updater_client,
        "get_target",
        lambda: _coro({"image": "ghcr.io/mrkprdo/homst:latest", "labels": {}}),
    )
    monkeypatch.setattr(
        worker.updater_client,
        "get_status",
        lambda: _coro({"job": None, "held_version": None}),
    )
    monkeypatch.setattr(worker, "fetch_releases", lambda: _coro(_feed()))
    monkeypatch.setattr(worker, "get_redis", lambda: _coro(FakeRedis()))
    monkeypatch.setattr(worker, "publish_event", lambda *a, **k: _coro(None))


def _coro(value):
    async def _inner(*args, **kwargs):
        return value

    return _inner()


@pytest.mark.asyncio
async def test_auto_update_installs_new_stable_release(monkeypatch):
    calls = []

    async def fake_install(version, latest):
        calls.append((version, latest))
        return {"id": "job-1"}

    _patch_common(
        monkeypatch,
        {"updates": {"enabled": True, "windowStart": "00:00", "windowEnd": "23:59"}},
    )
    monkeypatch.setattr(worker.updater_client, "install", fake_install)

    await worker.check_auto_update(None)
    assert calls == [("0.3.0", True)]


@pytest.mark.asyncio
async def test_auto_update_skips_disabled_and_held(monkeypatch):
    calls = []

    async def fake_install(version, latest):
        calls.append(version)
        return {"id": "job-1"}

    _patch_common(monkeypatch, {"updates": {"enabled": False}})
    monkeypatch.setattr(worker.updater_client, "install", fake_install)
    await worker.check_auto_update(None)
    assert calls == []

    _patch_common(monkeypatch, {"updates": {"enabled": True}})
    monkeypatch.setattr(
        worker.updater_client,
        "get_status",
        lambda: _coro({"job": None, "held_version": "0.3.0"}),
    )
    await worker.check_auto_update(None)
    assert calls == []


@pytest.mark.asyncio
async def test_auto_update_skips_major_by_default(monkeypatch):
    calls = []

    async def fake_install(version, latest):
        calls.append(version)
        return {"id": "job-1"}

    _patch_common(monkeypatch, {"updates": {"enabled": True}})
    monkeypatch.setattr(worker, "fetch_releases", lambda: _coro(_feed("1.0.0")))
    monkeypatch.setattr(worker.updater_client, "install", fake_install)

    await worker.check_auto_update(None)
    assert calls == []


@pytest.mark.asyncio
async def test_auto_update_respects_window(monkeypatch):
    calls = []

    async def fake_install(version, latest):
        calls.append(version)
        return {"id": "job-1"}

    _patch_common(monkeypatch, {"updates": {"enabled": True}})
    monkeypatch.setattr(worker, "update_window_open", lambda *args: False)
    monkeypatch.setattr(worker.updater_client, "install", fake_install)

    await worker.check_auto_update(None)
    assert calls == []
