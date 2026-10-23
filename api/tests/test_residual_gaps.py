"""Residual coverage for the last few uncovered lines in the API.

Kept separate from ``test_coverage_gaps.py`` so the intent is clear: these
exercise defensive/fallback branches and a couple of untested endpoints.
"""

import io
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

UTC = timezone.utc


# ══════════════════════════════════════════════════════════════════════
# app/db.py — get_db session lifecycle
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_get_db_yields_a_session_then_closes_it(monkeypatch):
    from app import db as db_mod

    closed = {"count": 0}

    class _Session:
        async def close(self):
            closed["count"] += 1

    class _Ctx:
        async def __aenter__(self):
            return _Session()

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr(db_mod, "async_session", lambda *a, **k: _Ctx())

    gen = db_mod.get_db()
    session = await gen.__anext__()
    assert session is not None
    with pytest.raises(StopAsyncIteration):
        await gen.__anext__()
    assert closed["count"] == 1


# ══════════════════════════════════════════════════════════════════════
# app/redis_client.py
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_get_redis_caches_client_and_close_resets_it(monkeypatch):
    from app import redis_client as redis_mod

    created = {}

    class _R:
        async def close(self):
            created["closed"] = True

    def _from_url(url, **kwargs):
        created["url"] = url
        return _R()

    monkeypatch.setattr(redis_mod, "redis_client", None, raising=False)
    monkeypatch.setattr(redis_mod.redis, "from_url", _from_url)

    first = await redis_mod.get_redis()
    second = await redis_mod.get_redis()
    assert first is second
    assert "url" in created

    await redis_mod.close_redis()
    assert created["closed"] is True
    assert redis_mod.redis_client is None


@pytest.mark.asyncio
async def test_close_redis_without_a_client_is_a_noop(monkeypatch):
    from app import redis_client as redis_mod

    monkeypatch.setattr(redis_mod, "redis_client", None, raising=False)
    await redis_mod.close_redis()  # must not raise
    assert redis_mod.redis_client is None


# ══════════════════════════════════════════════════════════════════════
# app/notifications/reminders.py
# ══════════════════════════════════════════════════════════════════════


def _event(start_at, recurrence=None):
    from app.models.all import Event

    return Event(
        calendar_id="cal", title="t", start_at=start_at, end_at=None,
        recurrence=recurrence, reminder_minutes=30, source="internal",
    )


def test_occurrences_biweekly_and_yearly():
    from app.notifications.reminders import occurrences_between

    start = datetime(2030, 6, 3, 18, 0, tzinfo=UTC)
    biweekly = _event(start, {"freq": "biweekly", "count": 3})
    occs = occurrences_between(biweekly, start, start + timedelta(days=90))
    assert occs == [start + timedelta(days=14 * i) for i in range(3)]

    yearly = _event(start, {"freq": "yearly", "count": 2})
    occs = occurrences_between(yearly, start, start + timedelta(days=800))
    assert occs == [start, datetime(2031, 6, 3, 18, 0, tzinfo=UTC)]


def test_occurrences_unknown_frequency_yields_only_the_first_start():
    from app.notifications.reminders import occurrences_between

    start = datetime(2030, 6, 3, 18, 0, tzinfo=UTC)
    occs = occurrences_between(
        _event(start, {"freq": "hourly"}), start, start + timedelta(days=1)
    )
    # An unrecognised frequency can't be stepped, so expansion stops at the start.
    assert occs == [start]


@pytest.mark.asyncio
async def test_find_due_reminders_without_calendars_returns_empty(db_session):
    from app.notifications.reminders import find_due_reminders

    assert await find_due_reminders(db_session, datetime.now(UTC)) == []


@pytest.mark.asyncio
async def test_dispatch_rolls_back_on_integrity_error(monkeypatch, db_session):
    from app.notifications import reminders

    item = reminders.DueReminder(
        event=_event(datetime.now(UTC) + timedelta(minutes=10)),
        occurrence_at=datetime.now(UTC),
        minutes_before=30,
    )

    async def fake_find(session, now):
        return [item]

    async def boom(*args, **kwargs):
        raise IntegrityError("stmt", {}, Exception("duplicate"))

    monkeypatch.setattr(reminders, "find_due_reminders", fake_find)
    monkeypatch.setattr(reminders, "_dispatch_one", boom)

    # Must swallow the IntegrityError and return no logs.
    assert await reminders.dispatch_due_reminders(db_session) == []


@pytest.mark.asyncio
async def test_send_test_notification_reports_hud_failure():
    from app.notifications.reminders import send_test_notification

    async def failing_hud(household_id, payload):
        return False, "display offline"

    results = await send_test_notification(channels=["hud"], deliver_hud=failing_hud)
    assert results["hud"] == "failed: display offline"


# ══════════════════════════════════════════════════════════════════════
# app/routers/photos.py
# ══════════════════════════════════════════════════════════════════════


def _png_bytes():
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (10, 10), (10, 20, 30)).save(buf, "PNG")
    return buf.getvalue()


def test_resize_image_rejects_unsupported_formats():
    from PIL import Image

    from app.routers.photos import _resize_image

    buf = io.BytesIO()
    Image.new("RGB", (4, 4)).save(buf, "GIF")
    with pytest.raises(ValueError):
        _resize_image(buf.getvalue())


def test_resize_image_converts_non_rgb_jpeg():
    from PIL import Image

    from app.routers.photos import _resize_image

    buf = io.BytesIO()
    Image.new("CMYK", (4, 4)).save(buf, "JPEG")
    out = _resize_image(buf.getvalue())
    assert out[:2] == b"\xff\xd8"  # still a JPEG


def test_resize_image_encodes_webp():
    from PIL import Image, features

    if not features.check("webp"):
        pytest.skip("Pillow built without WEBP support")

    from app.routers.photos import _resize_image

    buf = io.BytesIO()
    Image.new("RGB", (4, 4)).save(buf, "WEBP")
    out = _resize_image(buf.getvalue())
    assert out[:4] == b"RIFF"


@pytest.mark.asyncio
async def test_upload_photo_reuses_the_household_row(client):
    r1 = await client.post(
        "/api/v1/photos",
        files={"file": ("a.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert r1.status_code == 201
    r2 = await client.post(
        "/api/v1/photos",
        files={"file": ("b.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert r2.status_code == 201

    try:
        import os

        for body in (r1.json(), r2.json()):
            path = os.path.join("uploads/photos", body["url"].rsplit("/", 1)[-1])
            if os.path.exists(path):
                os.remove(path)
    except Exception:  # pragma: no cover - best-effort cleanup
        pass


# ══════════════════════════════════════════════════════════════════════
# app/routers/calendar.py — patching the recurrence rule
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_update_event_sets_recurrence(client):
    r = await client.post("/api/v1/calendars", json={"name": "C", "color": "sage"})
    cal_id = r.json()["id"]
    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "Weekly",
        "start_at": "2030-06-01T10:00:00Z", "end_at": "2030-06-01T11:00:00Z",
    })
    ev_id = r.json()["id"]

    r = await client.patch(f"/api/v1/events/{ev_id}", json={
        "recurrence": {"freq": "weekly", "count": 4},
    })
    assert r.status_code == 200
    assert r.json()["recurrence"] == {"freq": "weekly", "count": 4}


# ══════════════════════════════════════════════════════════════════════
# app/mdns.py — fallbacks
# ══════════════════════════════════════════════════════════════════════


def test_mdns_local_ip_falls_back_when_routing_fails(monkeypatch):
    from app import mdns as mdns_mod

    class _Socket:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def connect(self, addr):
            raise OSError("no route to host")

    monkeypatch.setattr(mdns_mod.socket, "socket", lambda *a, **k: _Socket())
    assert mdns_mod.HOMSTmDNS._local_ip() == "127.0.0.1"


def test_mdns_stop_sync_is_a_noop_when_never_started():
    from app import mdns as mdns_mod

    svc = mdns_mod.HOMSTmDNS(host="127.0.0.1")
    svc._stop_sync()  # must not raise
    assert svc._zc is None


def _exec_isolated(path, name):
    """Execute a module file under a throwaway name.

    Importing a *copy* of a module lets us exercise import-time branches
    (missing optional dependency, alternate configuration) that can only
    happen once per process.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_mdns_module_survives_a_missing_zeroconf(monkeypatch):
    import builtins

    from app import mdns as mdns_mod

    real_import = builtins.__import__

    def blocking_import(name, *args, **kwargs):
        if name == "zeroconf" or name.startswith("zeroconf."):
            raise ImportError("simulated: zeroconf not installed")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", blocking_import)
    probe = _exec_isolated(mdns_mod.__file__, "app._mdns_without_zeroconf")

    assert probe._ZEROCONF_AVAILABLE is False


# ══════════════════════════════════════════════════════════════════════
# app/routers/stream.py — resubscribe after a pubsub error
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_stream_reconnects_after_pubsub_error(monkeypatch, db_session):
    from app.routers import stream as stream_mod

    state = {"raised": False}

    class _PubSub:
        def __init__(self):
            self.closed = 0

        async def subscribe(self, channel):
            self.channel = channel

        async def unsubscribe(self, channel):
            pass

        async def close(self):
            self.closed += 1

        async def get_message(self, ignore_subscribe_messages=False, timeout=None):
            # Fail exactly once so the generator reconnects, then go quiet.
            if not state["raised"]:
                state["raised"] = True
                raise ConnectionError("redis went away")
            return None

    instances = []

    class _Redis:
        def pubsub(self):
            ps = _PubSub()
            instances.append(ps)
            return ps

    async def fake_get_redis():
        return _Redis()

    monkeypatch.setattr(stream_mod, "get_redis", fake_get_redis)

    class _Request:
        def __init__(self):
            self.calls = 0

        async def is_disconnected(self):
            self.calls += 1
            return self.calls > 3

    resp = await stream_mod.stream(_Request(), db_session)
    out = [item async for item in resp.body_iterator]

    # Two sync hints: one on the initial subscribe, one after the resubscribe —
    # everything published during the gap would otherwise be lost.
    assert out == [
        {"event": "sync.required", "data": '{"type": "sync.required"}'},
        {"event": "sync.required", "data": '{"type": "sync.required"}'},
    ]
    assert len(instances) == 2      # a fresh pubsub was created
    assert instances[0].closed == 1  # the broken one was closed
    assert instances[1].closed == 1  # the replacement was cleaned up


# ══════════════════════════════════════════════════════════════════════
# app/main.py — CORS allow-list configuration
# ══════════════════════════════════════════════════════════════════════


def test_main_uses_the_configured_cors_allow_list(monkeypatch):
    from fastapi.middleware.cors import CORSMiddleware

    from app import main as main_mod
    from app.config import settings

    monkeypatch.setattr(settings, "cors_allow_all", False)
    probe = _exec_isolated(main_mod.__file__, "app._main_with_allowlist")

    installed = [
        m for m in probe.app.user_middleware
        if getattr(m, "cls", None) is CORSMiddleware
    ]
    assert installed, "CORS middleware should be installed"
    assert installed[-1].kwargs["allow_origins"] == settings.allowed_origins.split(",")
    assert installed[-1].kwargs["allow_origins"] != ["*"]
