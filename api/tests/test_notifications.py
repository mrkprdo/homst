"""Tests for event reminders and notification dispatch."""
from datetime import datetime, timedelta, timezone

import pytest

from app.models.all import Calendar, Event, Household
from app.notifications.reminders import (
    DEFAULT_HOUSEHOLD_ID,
    dispatch_due_reminders,
    find_due_reminders,
    occurrences_between,
    send_test_notification,
)
from app.notifications.senders import format_lead, format_start

UTC = timezone.utc


def _dt(**kwargs) -> datetime:
    return datetime.now(UTC) + timedelta(**kwargs)


async def _seed_event(
    db_session, *, start_at, reminder_minutes=30, recurrence=None, assignee_id=None
):
    if await db_session.get(Household, DEFAULT_HOUSEHOLD_ID) is None:
        db_session.add(Household(id=DEFAULT_HOUSEHOLD_ID, name="Home", settings={}))
    calendar = Calendar(
        household_id=DEFAULT_HOUSEHOLD_ID, name="Personal", color="sage", source="internal"
    )
    db_session.add(calendar)
    await db_session.flush()
    event = Event(
        calendar_id=calendar.id,
        title="Soccer practice",
        start_at=start_at,
        end_at=start_at + timedelta(hours=1),
        recurrence=recurrence,
        reminder_minutes=reminder_minutes,
        source="internal",
        assignee_id=assignee_id,
    )
    db_session.add(event)
    await db_session.commit()
    return event


# ── Event reminder field ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_event_with_reminder(client):
    r = await client.post("/api/v1/calendars", json={"name": "Personal", "color": "sage"})
    cal_id = r.json()["id"]

    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id,
        "title": "Dinner",
        "start_at": "2030-06-01T18:00:00Z",
        "reminder_minutes": 60,
    })
    assert r.status_code == 201
    assert r.json()["reminder_minutes"] == 60


@pytest.mark.asyncio
async def test_update_event_can_clear_reminder(client):
    r = await client.post("/api/v1/calendars", json={"name": "Personal", "color": "sage"})
    cal_id = r.json()["id"]
    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "Dinner",
        "start_at": "2030-06-01T18:00:00Z", "reminder_minutes": 30,
    })
    event_id = r.json()["id"]

    r = await client.patch(f"/api/v1/events/{event_id}", json={"reminder_minutes": None})
    assert r.status_code == 200
    assert r.json()["reminder_minutes"] is None


# ── Message formatting ───────────────────────────────────────────────


def test_format_lead_phrases():
    assert format_lead(30) == "30 min"
    assert format_lead(60) == "1 hour"
    assert format_lead(120) == "2 hours"
    assert format_lead(1440) == "1 day"


def test_format_start_uses_household_timezone():
    start = datetime(2030, 6, 1, 18, 0, tzinfo=UTC)
    assert "2:00 PM" in format_start(start, "America/Toronto")  # EDT in June
    assert "6:00 PM" in format_start(start, "UTC")


# ── Occurrence expansion ─────────────────────────────────────────────


def _event(start_at, recurrence=None):
    return Event(
        calendar_id="cal", title="t", start_at=start_at, end_at=None,
        recurrence=recurrence, reminder_minutes=30, source="internal",
    )


def test_occurrences_non_recurring():
    start = datetime(2030, 6, 1, 18, 0, tzinfo=UTC)
    ev = _event(start)
    window = (start - timedelta(hours=1), start + timedelta(hours=1))
    assert occurrences_between(ev, *window) == [start]
    assert occurrences_between(ev, start + timedelta(hours=1), start + timedelta(days=1)) == []


def test_occurrences_weekly_with_until():
    start = datetime(2030, 6, 3, 18, 0, tzinfo=UTC)  # a Monday
    until = (start + timedelta(days=21)).isoformat()
    ev = _event(start, {"freq": "weekly", "until": until})
    occs = occurrences_between(ev, start, start + timedelta(days=60))
    assert occs == [start + timedelta(days=7 * i) for i in range(4)]


def test_occurrences_respects_count():
    start = datetime(2030, 6, 3, 18, 0, tzinfo=UTC)
    ev = _event(start, {"freq": "daily", "count": 3})
    occs = occurrences_between(ev, start, start + timedelta(days=10))
    assert occs == [start, start + timedelta(days=1), start + timedelta(days=2)]


def test_occurrences_monthly_clamps_short_months():
    start = datetime(2030, 1, 31, 9, 0, tzinfo=UTC)
    ev = _event(start, {"freq": "monthly"})
    occs = occurrences_between(ev, start, start + timedelta(days=90))
    assert occs[0] == start
    assert occs[1] == datetime(2030, 2, 28, 9, 0, tzinfo=UTC)


# ── Due detection & dispatch ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_find_due_reminders_window(db_session):
    due_event = await _seed_event(db_session, start_at=_dt(minutes=30), reminder_minutes=30)
    too_far = await _seed_event(db_session, start_at=_dt(days=2), reminder_minutes=30)
    no_reminder = await _seed_event(db_session, start_at=_dt(minutes=30), reminder_minutes=None)

    now = datetime.now(UTC)
    due = await find_due_reminders(db_session, now)
    ids = {d.event.id for d in due}
    assert due_event.id in ids
    assert too_far.id not in ids
    assert no_reminder.id not in ids


@pytest.mark.asyncio
async def test_dispatch_hud_and_idempotency(db_session):
    await _seed_event(db_session, start_at=_dt(minutes=30), reminder_minutes=30)
    now = datetime.now(UTC)

    hud_calls = []

    async def fake_hud(household_id, payload):
        hud_calls.append(payload)
        return True, "published"

    logs = await dispatch_due_reminders(db_session, now, deliver_hud=fake_hud)
    assert len(logs) == 1
    assert logs[0].channel == "hud"
    assert logs[0].status == "sent"
    assert len(hud_calls) == 1
    assert hud_calls[0]["title"] == "Soccer practice"

    # Second run at the same instant must not re-send.
    logs2 = await dispatch_due_reminders(db_session, now, deliver_hud=fake_hud)
    assert logs2 == []
    assert len(hud_calls) == 1


@pytest.mark.asyncio
async def test_dispatch_recurring_occurrence_reminds(db_session):
    # Weekly event that started last week — its *next* occurrence is due soon.
    now = datetime.now(UTC)
    start = now - timedelta(days=7) + timedelta(minutes=30)
    await _seed_event(
        db_session, start_at=start, reminder_minutes=30,
        recurrence={"freq": "weekly"},
    )

    hud_calls = []

    async def fake_hud(household_id, payload):
        hud_calls.append(payload)
        return True, "published"

    logs = await dispatch_due_reminders(db_session, now, deliver_hud=fake_hud)
    assert [log.channel for log in logs] == ["hud"]
    assert len(hud_calls) == 1


# ── Test endpoint ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_send_test_notification_reports_channels():
    hud_calls = []

    async def fake_hud(household_id, payload):
        hud_calls.append(payload)
        return True, "published"

    results = await send_test_notification(
        channels=["hud"], deliver_hud=fake_hud,
    )
    assert results["hud"] == "sent to the display"
    assert len(hud_calls) == 1


@pytest.mark.asyncio
async def test_send_test_notification_reports_push_without_session():
    async def fake_hud(household_id, payload):
        return True, "published"

    results = await send_test_notification(
        channels=["push"], deliver_hud=fake_hud,
    )
    assert results["push"] == "skipped: no database session"


@pytest.mark.asyncio
async def test_test_endpoint_forwards_channels(client, monkeypatch):
    captured = {}

    async def fake_send_test_notification(*, channels=None, session=None):
        captured.update(channels=channels)
        return {"hud": "sent to the display"}

    monkeypatch.setattr(
        "app.routers.notifications.send_test_notification", fake_send_test_notification
    )

    r = await client.post("/api/v1/notifications/test", json={"channels": ["hud"]})
    assert r.status_code == 200
    assert r.json()["results"]["hud"] == "sent to the display"
    assert captured["channels"] == ["hud"]
