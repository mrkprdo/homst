"""Coverage-gap tests: stream, mdns, workers, senders, main lifespan,
plus error/edge branches in the calendar, tasks, holidays, settings, photos
and users routers.
"""
import io
import os
from datetime import datetime, timezone

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy.exc import OperationalError

from app.models.all import Calendar, Event, Household

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"


# ── helpers ──────────────────────────────────────────────────────────


class _FakeResp:
    def __init__(self, *, json_data=None, status_code=200, text=""):
        self._json = json_data if json_data is not None else {}
        self.status_code = status_code
        self.is_error = status_code >= 400
        self.is_success = 200 <= status_code < 300
        self.text = text

    def json(self):
        return self._json


def _fake_async_client(responses, sink=None):
    """Build a stand-in for ``httpx.AsyncClient`` with canned responses."""

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, timeout=None, params=None):
            if sink is not None:
                sink.append({"url": url, "params": params})
            resp = responses.pop(0)
            if isinstance(resp, Exception):
                raise resp
            return resp

    return _Client


async def _seed_external_event(db_session):
    if await db_session.get(Household, DEFAULT_HOUSEHOLD_ID) is None:
        db_session.add(Household(id=DEFAULT_HOUSEHOLD_ID, name="Home", settings={}))
    cal = Calendar(
        household_id=DEFAULT_HOUSEHOLD_ID, name="Imported", color="sky", source="ical"
    )
    db_session.add(cal)
    await db_session.flush()
    ev = Event(
        calendar_id=cal.id,
        title="Imported event",
        start_at=datetime(2030, 6, 1, 10, 0, tzinfo=timezone.utc),
        source="external",
        external_uid="uid-1",
    )
    db_session.add(ev)
    await db_session.commit()
    return cal, ev


# ══════════════════════════════════════════════════════════════════════
# routers/stream.py
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_stream_generator_decodes_and_dispatches(monkeypatch, db_session):
    from app.routers import stream as stream_mod

    class _PubSub:
        def __init__(self):
            self.messages = [
                {"data": '{"type": "event.created", "id": "1"}'},
                {"data": b'{"type": "event.updated", "id": "2"}'},
                {"data": ""},              # empty payload → skipped
                {"data": "not json"},      # invalid JSON → yielded raw
            ]

        async def subscribe(self, channel):
            self.channel = channel

        async def unsubscribe(self, channel):
            pass

        async def close(self):
            pass

        async def get_message(self, ignore_subscribe_messages=False, timeout=None):
            return self.messages.pop(0) if self.messages else None

    class _Redis:
        def pubsub(self):
            return _PubSub()

    async def fake_get_redis():
        return _Redis()

    monkeypatch.setattr(stream_mod, "get_redis", fake_get_redis)

    class _Request:
        def __init__(self):
            self.calls = 0

        async def is_disconnected(self):
            self.calls += 1
            return self.calls > 4

    resp = await stream_mod.stream(_Request(), db_session)
    out = [item async for item in resp.body_iterator]

    assert out[0] == {"event": "sync.required", "data": '{"type": "sync.required"}'}
    assert out[1] == {
        "event": "event.created",
        "data": '{"type": "event.created", "id": "1"}',
    }
    assert out[2]["event"] == "event.updated"
    assert out[3] == {"data": "not json"}


# ══════════════════════════════════════════════════════════════════════
# mdns.py
# ══════════════════════════════════════════════════════════════════════


def test_mdns_local_ip_returns_string():
    from app.mdns import HOMSTmDNS

    assert isinstance(HOMSTmDNS._local_ip(), str)


@pytest.mark.asyncio
async def test_mdns_start_stop(monkeypatch):
    from app import mdns as mdns_mod

    seen = {}

    class _Info:
        def __init__(self, **kwargs):
            seen["info"] = kwargs

    class _Zeroconf:
        def register_service(self, info):
            seen["registered"] = info

        def unregister_service(self, info):
            seen["unregistered"] = info

        def close(self):
            seen["closed"] = True

    monkeypatch.setattr(mdns_mod, "_ZEROCONF_AVAILABLE", True)
    monkeypatch.setattr(mdns_mod, "ServiceInfo", _Info)
    monkeypatch.setattr(mdns_mod, "Zeroconf", _Zeroconf)

    svc = mdns_mod.HOMSTmDNS(host="127.0.0.1", port=9999, instance_name="Test")
    await svc.start()
    assert svc._zc is not None
    assert seen["info"]["port"] == 9999
    assert seen["info"]["type_"] == "_homst._tcp.local."

    # Second start is a no-op (already registered)
    await svc.start()

    await svc.stop()
    assert svc._zc is None
    assert seen["closed"] is True
    assert "unregistered" in seen


@pytest.mark.asyncio
async def test_mdns_start_without_zeroconf(monkeypatch):
    from app import mdns as mdns_mod

    monkeypatch.setattr(mdns_mod, "_ZEROCONF_AVAILABLE", False)
    svc = mdns_mod.HOMSTmDNS(host="127.0.0.1")
    await svc.start()
    assert svc._zc is None
    # stop on a never-started service is a no-op
    await svc.stop()


@pytest.mark.asyncio
async def test_mdns_start_swallows_registration_errors(monkeypatch):
    from app import mdns as mdns_mod

    class _Info:
        def __init__(self, **kwargs):
            pass

    def _boom():
        raise RuntimeError("registration failed")

    monkeypatch.setattr(mdns_mod, "_ZEROCONF_AVAILABLE", True)
    monkeypatch.setattr(mdns_mod, "ServiceInfo", _Info)
    monkeypatch.setattr(mdns_mod, "Zeroconf", _boom)

    svc = mdns_mod.HOMSTmDNS(host="127.0.0.1")
    await svc.start()  # must not raise
    assert svc._zc is None


# ══════════════════════════════════════════════════════════════════════
# workers/settings.py
# ══════════════════════════════════════════════════════════════════════


class _SessionCtx:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


@pytest.mark.asyncio
async def test_worker_dispatch_reminders_and_misc(monkeypatch, db_session, capsys):
    from app.workers import settings as worker_mod

    monkeypatch.setattr(worker_mod, "async_session", lambda: _SessionCtx(db_session))

    class _Log:
        def __init__(self, status):
            self.status = status

    async def fake_dispatch(session):
        return [_Log("sent"), _Log("failed")]

    monkeypatch.setattr(worker_mod, "dispatch_due_reminders", fake_dispatch)

    await worker_mod.dispatch_reminders(None)
    assert "1/2 channel deliveries sent" in capsys.readouterr().out

    async def fake_dispatch_empty(session):
        return []

    monkeypatch.setattr(worker_mod, "dispatch_due_reminders", fake_dispatch_empty)
    await worker_mod.dispatch_reminders(None)

    await worker_mod.startup(None)
    await worker_mod.shutdown(None)
    out = capsys.readouterr().out
    assert "worker started" in out
    assert "worker shutting" in out

    assert len(worker_mod.WorkerSettings.cron_jobs) == 3
    assert worker_mod.check_auto_update in worker_mod.WorkerSettings.functions
    assert worker_mod.apply_auto_theme in worker_mod.WorkerSettings.functions
    assert worker_mod.WorkerSettings.on_startup is worker_mod.startup


# ══════════════════════════════════════════════════════════════════════
# notifications/senders.py
# ══════════════════════════════════════════════════════════════════════


def test_format_lead_more_phrases():
    from app.notifications.senders import format_lead

    assert format_lead(2880) == "2 days"
    assert format_lead(90) == "90 min"
    assert format_lead(45) == "45 min"


def test_format_start_relative_days():
    from app.notifications.senders import format_start

    now = datetime(2030, 6, 1, 8, 0, tzinfo=timezone.utc)
    assert format_start(datetime(2030, 6, 1, 18, 0, tzinfo=timezone.utc), "UTC", now).startswith("today at")
    assert format_start(datetime(2030, 6, 2, 18, 0, tzinfo=timezone.utc), "UTC", now).startswith("tomorrow at")
    other = format_start(datetime(2030, 6, 5, 18, 0, tzinfo=timezone.utc), "UTC", now)
    assert other.startswith("Wed, Jun 05")


def test_household_tz_invalid_falls_back_to_utc():
    from app.notifications.senders import _household_tz

    assert _household_tz("Not/AZone").utcoffset(None).total_seconds() == 0
    assert _household_tz(None).utcoffset(None).total_seconds() == 0


@pytest.mark.asyncio
async def test_publish_hud_reminder_success_and_failure(monkeypatch):
    from app.notifications import senders

    async def fake_publish(household_id, event_type, data):
        fake_publish.calls.append((household_id, event_type, data))

    fake_publish.calls = []
    monkeypatch.setattr(senders, "publish_event", fake_publish)
    ok, detail = await senders.publish_hud_reminder("hh-1", {"title": "x"})
    assert ok is True and detail == "published"
    assert fake_publish.calls[0][0] == "hh-1"

    async def boom(*args, **kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr(senders, "publish_event", boom)
    ok, detail = await senders.publish_hud_reminder("hh-1", {})
    assert ok is False and "RuntimeError" in detail


# ══════════════════════════════════════════════════════════════════════
# main.py — startup helpers
# ══════════════════════════════════════════════════════════════════════


class _FakeConn:
    async def run_sync(self, fn):
        return None

    async def execute(self, stmt):
        return None


class _FakeEngine:
    def begin(self):
        conn = _FakeConn()

        class _CM:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *exc):
                return False

        return _CM()


@pytest.mark.asyncio
async def test_wait_for_database_succeeds(monkeypatch):
    from app import main

    monkeypatch.setattr(main, "engine", _FakeEngine())
    await main._wait_for_database(max_retries=1, initial_delay=0)


@pytest.mark.asyncio
async def test_wait_for_database_retries_then_raises(monkeypatch):
    from app import main

    class _FailingEngine:
        def begin(self):
            class _CM:
                async def __aenter__(self):
                    raise OperationalError("stmt", {}, Exception("down"))

                async def __aexit__(self, *exc):
                    return False

            return _CM()

    monkeypatch.setattr(main, "engine", _FailingEngine())
    with pytest.raises(OperationalError):
        await main._wait_for_database(max_retries=2, initial_delay=0)


@pytest.mark.asyncio
async def test_lifespan_without_mdns(monkeypatch):
    from app import main

    calls = {"wait": 0, "redis": 0, "close": 0, "dispose": 0}

    async def fake_wait():
        calls["wait"] += 1

    async def fake_redis():
        calls["redis"] += 1

    async def fake_close():
        calls["close"] += 1

    class _Engine:
        async def dispose(self):
            calls["dispose"] += 1

    monkeypatch.setattr(main, "_wait_for_database", fake_wait)
    monkeypatch.setattr(main, "get_redis", fake_redis)
    monkeypatch.setattr(main, "close_redis", fake_close)
    monkeypatch.setattr(main, "engine", _Engine())
    monkeypatch.setattr(main.settings, "mdns_enabled", False)

    async with main.lifespan(main.app):
        pass

    assert calls == {"wait": 1, "redis": 1, "close": 1, "dispose": 1}


@pytest.mark.asyncio
async def test_lifespan_with_mdns(monkeypatch):
    from app import main

    calls = {"start": 0, "stop": 0}

    async def fake_start():
        calls["start"] += 1

    async def fake_stop():
        calls["stop"] += 1

    async def noop():
        pass

    class _Engine:
        async def dispose(self):
            pass

    monkeypatch.setattr(main, "_wait_for_database", noop)
    monkeypatch.setattr(main, "get_redis", noop)
    monkeypatch.setattr(main, "close_redis", noop)
    monkeypatch.setattr(main, "engine", _Engine())
    monkeypatch.setattr(main.settings, "mdns_enabled", True)
    monkeypatch.setattr(main.settings, "mdns_instance_name", "HOMST-Test")
    monkeypatch.setattr(main.homst_mdns, "start", fake_start)
    monkeypatch.setattr(main.homst_mdns, "stop", fake_stop)

    async with main.lifespan(main.app):
        pass

    assert calls == {"start": 1, "stop": 1}


# ══════════════════════════════════════════════════════════════════════
# routers/calendar.py — extra branches
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_create_event_end_before_start_422(client):
    r = await client.post("/api/v1/calendars", json={"name": "C", "color": "sage"})
    cal_id = r.json()["id"]
    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "Bad",
        "start_at": "2030-06-01T12:00:00Z", "end_at": "2030-06-01T10:00:00Z",
    })
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_event_full_fields(client):
    r = await client.post("/api/v1/household/members", json={"name": "Alex"})
    member_id = r.json()["id"]
    r = await client.post("/api/v1/calendars", json={"name": "C", "color": "sage"})
    cal_id = r.json()["id"]

    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "Full", "description": "desc",
        "start_at": "2030-06-01T12:00:00Z", "end_at": "2030-06-01T13:00:00Z",
        "all_day": True, "recurrence": {"freq": "weekly"},
        "reminder_minutes": 15, "assignee_id": member_id,
    })
    assert r.status_code == 201
    data = r.json()
    assert data["description"] == "desc"
    assert data["recurrence"] == {"freq": "weekly"}
    assert data["reminder_minutes"] == 15
    assert data["assignee_id"] == member_id


@pytest.mark.asyncio
async def test_list_events_no_calendars_returns_empty(client):
    r = await client.get("/api/v1/events")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_list_events_filters(client):
    r = await client.post("/api/v1/calendars", json={"name": "A", "color": "sage"})
    cal_a = r.json()["id"]
    r = await client.post("/api/v1/calendars", json={"name": "B", "color": "sky"})
    cal_b = r.json()["id"]

    await client.post("/api/v1/events", json={
        "calendar_id": cal_a, "title": "A1", "start_at": "2030-05-01T10:00:00Z",
    })
    await client.post("/api/v1/events", json={
        "calendar_id": cal_b, "title": "B1", "start_at": "2030-07-01T10:00:00Z",
        "end_at": "2030-07-02T10:00:00Z",
    })

    # calendar_ids filter
    r = await client.get(f"/api/v1/events?calendar_ids={cal_b}")
    assert [e["title"] for e in r.json()] == ["B1"]

    # empty entries in calendar_ids are ignored
    r = await client.get(f"/api/v1/events?calendar_ids= , {cal_a} ,")
    assert [e["title"] for e in r.json()] == ["A1"]

    # to filter (start_at <= to)
    r = await client.get("/api/v1/events?to=2030-06-01T00:00:00Z")
    assert [e["title"] for e in r.json()] == ["A1"]

    # from filter uses coalesce(end_at, start_at)
    r = await client.get("/api/v1/events?from=2030-06-15T00:00:00Z")
    assert [e["title"] for e in r.json()] == ["B1"]


@pytest.mark.asyncio
async def test_update_event_end_before_start_422(client):
    r = await client.post("/api/v1/calendars", json={"name": "C", "color": "sage"})
    cal_id = r.json()["id"]
    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "E",
        "start_at": "2030-06-01T10:00:00Z", "end_at": "2030-06-01T11:00:00Z",
    })
    ev_id = r.json()["id"]
    r = await client.patch(f"/api/v1/events/{ev_id}", json={
        "start_at": "2030-06-01T12:00:00Z", "end_at": "2030-06-01T11:00:00Z",
    })
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_update_event_can_clear_end_at_and_assignee(client):
    r = await client.post("/api/v1/household/members", json={"name": "Alex"})
    member_id = r.json()["id"]
    r = await client.post("/api/v1/calendars", json={"name": "C", "color": "sage"})
    cal_id = r.json()["id"]
    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "E",
        "start_at": "2030-06-01T10:00:00Z", "end_at": "2030-06-01T11:00:00Z",
    })
    ev_id = r.json()["id"]

    r = await client.patch(f"/api/v1/events/{ev_id}", json={
        "end_at": None, "description": "updated", "all_day": False,
        "start_at": "2030-06-02T10:00:00Z", "assignee_id": member_id,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["end_at"] is None
    assert data["description"] == "updated"
    assert data["assignee_id"] == member_id


@pytest.mark.asyncio
async def test_external_event_is_read_only(client, db_session):
    cal, ev = await _seed_external_event(db_session)

    r = await client.get("/api/v1/events")
    assert any(e["id"] == ev.id and e["source"] == "external" for e in r.json())

    r = await client.patch(f"/api/v1/events/{ev.id}", json={"title": "Nope"})
    assert r.status_code == 403

    r = await client.delete(f"/api/v1/events/{ev.id}")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_update_calendar_color(client):
    r = await client.post("/api/v1/calendars", json={"name": "C", "color": "sage"})
    cal_id = r.json()["id"]
    r = await client.patch(f"/api/v1/calendars/{cal_id}", json={"color": "plum"})
    assert r.status_code == 200
    assert r.json()["color"] == "plum"


@pytest.mark.asyncio
async def test_subscribe_calendar_default_name(client):
    r = await client.post("/api/v1/calendars/subscribe", json={
        "feed_url": "https://example.com/f.ics",
    })
    assert r.status_code == 201
    assert r.json()["name"] == "Subscribed Calendar"


# ══════════════════════════════════════════════════════════════════════
# routers/tasks.py — extra branches
# ══════════════════════════════════════════════════════════════════════


async def _make_list(client, name="L"):
    r = await client.post("/api/v1/task-lists", json={"name": name, "color": "taupe", "position": 0})
    return r.json()["id"]


@pytest.mark.asyncio
async def test_list_tasks_no_lists_returns_empty(client):
    r = await client.get("/api/v1/tasks")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_update_task_all_fields(client):
    r = await client.post("/api/v1/household/members", json={"name": "Alex"})
    member_id = r.json()["id"]
    list_id = await _make_list(client)
    r = await client.post("/api/v1/tasks", json={"list_id": list_id, "title": "T"})
    task_id = r.json()["id"]

    r = await client.patch(f"/api/v1/tasks/{task_id}", json={
        "title": "T2", "description": "d", "assignee_id": member_id,
        "start_at": "2030-06-01T09:00:00Z", "end_at": "2030-06-01T10:00:00Z",
        "status": "doing", "priority": "high", "position": 3,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["title"] == "T2"
    assert data["description"] == "d"
    assert data["assignee_id"] == member_id
    assert data["status"] == "doing"
    assert data["priority"] == "high"
    assert data["position"] == 3


@pytest.mark.asyncio
async def test_task_update_move_delete_not_found(client):
    ghost = "00000000-0000-0000-0000-000000000099"
    r = await client.patch(f"/api/v1/tasks/{ghost}", json={"title": "x"})
    assert r.status_code == 404
    r = await client.patch(f"/api/v1/tasks/{ghost}/move", json={"list_id": ghost, "position": 0})
    assert r.status_code == 404
    r = await client.delete(f"/api/v1/tasks/{ghost}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_update_and_delete_task_list_not_found(client):
    ghost = "00000000-0000-0000-0000-000000000099"
    r = await client.patch(f"/api/v1/task-lists/{ghost}", json={"name": "x"})
    assert r.status_code == 404
    r = await client.delete(f"/api/v1/task-lists/{ghost}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_update_task_list_fields(client):
    list_id = await _make_list(client)
    r = await client.patch(f"/api/v1/task-lists/{list_id}", json={
        "color": "sage", "position": 5,
    })
    assert r.status_code == 200
    assert r.json()["color"] == "sage"
    assert r.json()["position"] == 5


# ══════════════════════════════════════════════════════════════════════
# routers/users.py — extra branches
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_create_member_with_color_and_update_avatar(client):
    r = await client.post("/api/v1/household/members", json={
        "name": "Sam", "color": "plum", "avatar_url": "https://example.com/a.png",
    })
    assert r.status_code == 201
    assert r.json()["color"] == "plum"
    member_id = r.json()["id"]

    r = await client.patch(f"/api/v1/household/members/{member_id}", json={
        "avatar_url": "https://example.com/b.png", "color": "sky", "role": "admin",
    })
    assert r.status_code == 200
    assert r.json()["avatar_url"] == "https://example.com/b.png"
    assert r.json()["color"] == "sky"
    assert r.json()["role"] == "admin"


# ══════════════════════════════════════════════════════════════════════
# routers/holidays.py — httpx error branches
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_fetch_nager_holidays_success(monkeypatch):
    from app.routers import holidays as holidays_mod

    sink = []
    monkeypatch.setattr(
        holidays_mod.httpx,
        "AsyncClient",
        _fake_async_client([_FakeResp(json_data=[{"date": "2030-01-01", "name": "NY"}])], sink),
    )
    data = await holidays_mod._fetch_nager_holidays(2030, "US")
    assert data[0]["name"] == "NY"
    assert "PublicHolidays/2030/US" in sink[0]["url"]


@pytest.mark.asyncio
async def test_fetch_nager_holidays_http_error(monkeypatch):
    from app.routers import holidays as holidays_mod

    monkeypatch.setattr(
        holidays_mod.httpx,
        "AsyncClient",
        _fake_async_client([_FakeResp(status_code=500)]),
    )
    with pytest.raises(HTTPException) as exc:
        await holidays_mod._fetch_nager_holidays(2030, "US")
    assert exc.value.status_code == 502


@pytest.mark.asyncio
async def test_fetch_nager_holidays_network_error(monkeypatch):
    from app.routers import holidays as holidays_mod

    monkeypatch.setattr(
        holidays_mod.httpx,
        "AsyncClient",
        _fake_async_client([httpx.ConnectError("boom")]),
    )
    with pytest.raises(HTTPException) as exc:
        await holidays_mod._fetch_nager_holidays(2030, "US")
    assert exc.value.status_code == 502


# ══════════════════════════════════════════════════════════════════════
# routers/settings.py — normalization & geocoding
# ══════════════════════════════════════════════════════════════════════


def test_country_code_normalization():
    from app.routers.settings import _country_code

    assert _country_code(None) is None
    assert _country_code("") is None
    assert _country_code("  ") is None
    assert _country_code(" ca ") == "CA"
    assert _country_code("Canada") is None  # not 2 letters
    assert _country_code("C1") is None      # not alphabetic


@pytest.mark.asyncio
async def test_geocode_address_success_filters_mismatched_country(monkeypatch):
    from app.routers import settings as settings_mod

    sink = []
    monkeypatch.setattr(
        settings_mod.httpx,
        "AsyncClient",
        _fake_async_client([
            _FakeResp(json_data={
                "results": [
                    {"latitude": 34.0, "longitude": -117.6, "country_code": "US"},
                    {"latitude": 43.7, "longitude": -79.4, "country_code": "CA"},
                ],
            }),
        ], sink),
    )
    coords = await settings_mod._geocode_address("123 Main St, Toronto", "Ontario", "ca")
    assert coords == {"lat": 43.7, "lon": -79.4}
    # country code passed as filter, never appended to the query name
    assert sink[0]["params"]["countryCode"] == "CA"
    assert "CA" not in sink[0]["params"]["name"]


@pytest.mark.asyncio
async def test_geocode_address_skips_failed_and_returns_empty(monkeypatch):
    from app.routers import settings as settings_mod

    # first candidate returns a non-success response, no later candidate matches
    monkeypatch.setattr(
        settings_mod.httpx,
        "AsyncClient",
        _fake_async_client([
            _FakeResp(status_code=500),
            _FakeResp(json_data={"results": []}),
        ]),
    )
    coords = await settings_mod._geocode_address("Nowhere", "NowhereProv", "US")
    assert coords == {}


@pytest.mark.asyncio
async def test_geocode_address_swallows_exceptions(monkeypatch):
    from app.routers import settings as settings_mod

    monkeypatch.setattr(
        settings_mod.httpx,
        "AsyncClient",
        _fake_async_client([httpx.ConnectError("down")]),
    )
    assert await settings_mod._geocode_address("X", None, None) == {}


@pytest.mark.asyncio
async def test_update_settings_geocodes_when_coords_absent(client, monkeypatch):
    from app.routers import settings as settings_mod

    called = {}

    async def fake_geocode(address, province, country):
        called.update(address=address, province=province, country=country)
        return {"lat": 45.0, "lon": -75.0}

    monkeypatch.setattr(settings_mod, "_geocode_address", fake_geocode)

    r = await client.patch("/api/v1/household/settings", json={
        "settings": {"address": "1 Main St", "holidayProvince": "Ontario", "holidayCountry": "CA"},
    })
    assert r.status_code == 200

    r = await client.get("/api/v1/household/settings")
    data = r.json()
    assert data["lat"] == 45.0 and data["lon"] == -75.0
    assert called["country"] == "CA"


@pytest.mark.asyncio
async def test_update_settings_skips_geocode_when_coords_present(client, monkeypatch):
    from app.routers import settings as settings_mod

    async def fake_geocode(*args, **kwargs):
        raise AssertionError("geocode should not be called")

    monkeypatch.setattr(settings_mod, "_geocode_address", fake_geocode)
    r = await client.patch("/api/v1/household/settings", json={
        "settings": {"address": "1 Main St", "lat": 1.0, "lon": 2.0},
    })
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_update_settings_with_name(client):
    r = await client.patch("/api/v1/household/settings", json={"name": "Maple House"})
    assert r.status_code == 200

    r = await client.get("/api/v1/household/settings")
    assert r.status_code == 200


# ══════════════════════════════════════════════════════════════════════
# routers/photos.py — list/update/delete branches
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_photos_list_update_delete(client):
    resp = await client.post(
        "/api/v1/photos",
        files={"file": ("pic.png", io.BytesIO(_png_bytes()), "image/png")},
    )
    assert resp.status_code == 201
    photo = resp.json()
    photo_id = photo["id"]
    path = os.path.join("uploads/photos", photo["url"].rsplit("/", 1)[-1])
    try:
        r = await client.get("/api/v1/photos")
        assert any(p["id"] == photo_id for p in r.json())

        r = await client.patch(f"/api/v1/photos/{photo_id}", json={"selected": False})
        assert r.status_code == 200
        assert r.json()["selected"] is False

        r = await client.delete(f"/api/v1/photos/{photo_id}")
        assert r.status_code == 204
        assert not os.path.exists(path)
    finally:
        if os.path.exists(path):
            os.remove(path)


@pytest.mark.asyncio
async def test_update_and_delete_photo_not_found(client):
    ghost = "00000000-0000-0000-0000-000000000099"
    r = await client.patch(f"/api/v1/photos/{ghost}", json={"selected": True})
    assert r.status_code == 404
    r = await client.delete(f"/api/v1/photos/{ghost}")
    assert r.status_code == 404


def _png_bytes():
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (10, 10), (10, 20, 30)).save(buf, "PNG")
    return buf.getvalue()
