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
    monkeypatch.setattr(worker, "_last_update_check", 0.0)
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
    monkeypatch.setattr(
        worker, "fetch_releases", lambda **kwargs: _coro(_feed())
    )


def _capture_events(monkeypatch):
    events = []

    async def fake_publish(household_id, event_type, data):
        events.append((household_id, event_type, data))

    monkeypatch.setattr(worker, "publish_event", fake_publish)
    return events


def _coro(value):
    async def _inner(*args, **kwargs):
        return value

    return _inner()


@pytest.mark.asyncio
async def test_update_check_prompts_displays_without_installing(monkeypatch):
    calls = []

    async def fake_install(version, latest):
        calls.append((version, latest))
        return {"id": "job-1"}

    _patch_common(monkeypatch, {"updates": {"enabled": True}})
    events = _capture_events(monkeypatch)
    monkeypatch.setattr(worker.updater_client, "install", fake_install)

    await worker.check_auto_update(None)

    assert calls == []
    assert len(events) == 1
    _household_id, event_type, payload = events[0]
    assert event_type == "system.update.available"
    assert payload["version"] == "0.3.0"
    assert payload["major"] is False


@pytest.mark.asyncio
async def test_update_check_skips_disabled_dismissed_and_held(monkeypatch):
    _patch_common(monkeypatch, {"updates": {"enabled": False}})
    events = _capture_events(monkeypatch)
    await worker.check_auto_update(None)
    assert events == []

    _patch_common(
        monkeypatch,
        {
            "updates": {"enabled": True},
            "updateDismissedVersion": "0.3.0",
        },
    )
    events = _capture_events(monkeypatch)
    await worker.check_auto_update(None)
    assert events == []

    _patch_common(monkeypatch, {"updates": {"enabled": True}})
    monkeypatch.setattr(
        worker.updater_client,
        "get_status",
        lambda: _coro({"job": None, "held_version": "0.3.0"}),
    )
    events = _capture_events(monkeypatch)
    await worker.check_auto_update(None)
    assert events == []


@pytest.mark.asyncio
async def test_update_check_prompts_for_major_with_warning_flag(monkeypatch):
    _patch_common(monkeypatch, {"updates": {"enabled": True}})
    monkeypatch.setattr(
        worker, "fetch_releases", lambda **kwargs: _coro(_feed("1.0.0"))
    )
    events = _capture_events(monkeypatch)

    await worker.check_auto_update(None)

    assert len(events) == 1
    assert events[0][2]["version"] == "1.0.0"
    assert events[0][2]["major"] is True


@pytest.mark.asyncio
async def test_update_check_respects_interval_and_rechecks_later(monkeypatch):
    _patch_common(monkeypatch, {"updates": {"enabled": True}})
    events = _capture_events(monkeypatch)

    await worker.check_auto_update(None)
    assert len(events) == 1

    await worker.check_auto_update(None)
    assert len(events) == 1

    # Pretend the 5-minute window elapsed.
    monkeypatch.setattr(worker, "_last_update_check", time.monotonic() - 301)
    await worker.check_auto_update(None)
    assert len(events) == 2


@pytest.mark.asyncio
async def test_update_check_skips_when_up_to_date_or_unmanaged(monkeypatch):
    _patch_common(monkeypatch, {"updates": {"enabled": True}}, version="0.3.0")
    events = _capture_events(monkeypatch)
    await worker.check_auto_update(None)
    assert events == []

    _patch_common(monkeypatch, {"updates": {"enabled": True}})
    monkeypatch.setattr(
        worker.updater_client,
        "get_target",
        lambda: _coro({"image": "ghcr.io/mrkprdo/homst:dev", "labels": {}}),
    )
    events = _capture_events(monkeypatch)
    await worker.check_auto_update(None)
    assert events == []


@pytest.mark.asyncio
async def test_update_check_skips_active_job(monkeypatch):
    _patch_common(monkeypatch, {"updates": {"enabled": True}})
    monkeypatch.setattr(
        worker.updater_client,
        "get_status",
        lambda: _coro({"job": {"state": "pulling"}, "held_version": None}),
    )
    events = _capture_events(monkeypatch)

    await worker.check_auto_update(None)
    assert events == []
