"""Input validation and reminder-worker resilience.

Covers the recurrence rule schema, holiday country normalization and the
defensive parsing done by the reminder worker on stored recurrence JSON.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.models.all import Event
from app.notifications.reminders import occurrences_between
from app.schemas.all import Recurrence

UTC = timezone.utc

START = "2030-06-03T18:00:00Z"


async def _make_calendar(client, name="Cal"):
    r = await client.post("/api/v1/calendars", json={"name": name, "color": "sage"})
    assert r.status_code == 201
    return r.json()["id"]


def _event(start_at, recurrence):
    return Event(
        calendar_id="cal", title="t", start_at=start_at, end_at=None,
        recurrence=recurrence, reminder_minutes=30, source="internal",
    )


def _nager_year(year, country_code="US"):
    return [{
        "date": f"{year}-01-01", "localName": "New Year", "name": "New Year",
        "countryCode": country_code, "fixed": True, "global": True,
        "counties": None, "types": ["Public"],
    }]


# ── Recurrence schema ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_event_returns_valid_recurrence_unchanged(client):
    cal_id = await _make_calendar(client)
    rule = {"freq": "weekly", "until": "2030-06-30T18:00:00Z", "count": 5}

    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "Standup", "start_at": START,
        "recurrence": rule,
    })
    assert r.status_code == 201
    assert r.json()["recurrence"] == rule


@pytest.mark.asyncio
async def test_create_event_recurrence_without_optional_fields(client):
    cal_id = await _make_calendar(client)

    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "Daily", "start_at": START,
        "recurrence": {"freq": "daily"},
    })
    assert r.status_code == 201
    # Optional fields stay absent rather than being serialised as null.
    assert r.json()["recurrence"] == {"freq": "daily"}


@pytest.mark.asyncio
async def test_update_event_stores_recurrence_as_plain_dict(client):
    cal_id = await _make_calendar(client)
    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "Monthly", "start_at": START,
    })
    event_id = r.json()["id"]

    r = await client.patch(f"/api/v1/events/{event_id}", json={
        "recurrence": {"freq": "monthly", "count": 12},
    })
    assert r.status_code == 200
    assert r.json()["recurrence"] == {"freq": "monthly", "count": 12}


@pytest.mark.asyncio
@pytest.mark.parametrize("rule", [
    {"freq": "hourly"},
    {"freq": "daily", "until": "garbage"},
    {"freq": "daily", "count": 0},
    {"freq": "daily", "count": 731},
])
async def test_create_event_rejects_invalid_recurrence(client, rule):
    cal_id = await _make_calendar(client)

    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "Bad", "start_at": START,
        "recurrence": rule,
    })
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_update_event_rejects_invalid_recurrence(client):
    cal_id = await _make_calendar(client)
    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "Fine", "start_at": START,
    })
    event_id = r.json()["id"]

    r = await client.patch(f"/api/v1/events/{event_id}", json={
        "recurrence": {"freq": "daily", "until": "not-a-date"},
    })
    assert r.status_code == 422


def test_recurrence_count_bounds_are_inclusive():
    assert Recurrence(freq="daily", count=1).count == 1
    assert Recurrence(freq="daily", count=730).count == 730


def test_recurrence_until_accepts_naive_and_zulu_timestamps():
    assert Recurrence(freq="daily", until="2030-06-30T18:00:00").until == "2030-06-30T18:00:00"
    assert Recurrence(freq="daily", until="2030-06-30T18:00:00Z").until == "2030-06-30T18:00:00Z"
    assert Recurrence(freq="daily", until=None).until is None


# ── Holiday sync requests ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_holiday_sync_normalizes_lowercase_country(client, monkeypatch):
    seen: list[str] = []

    async def mock_fetch(year, country_code):
        seen.append(country_code)
        return _nager_year(year, country_code)

    monkeypatch.setattr("app.routers.holidays._fetch_nager_holidays", mock_fetch)

    r = await client.post("/api/v1/holidays/sync", json={"country_code": "us"})
    assert r.status_code == 201
    assert seen == ["US", "US"]

    r = await client.get("/api/v1/holidays")
    holidays = r.json()
    assert len(holidays) == 2
    assert all(h["country_code"] == "US" for h in holidays)


@pytest.mark.asyncio
@pytest.mark.parametrize("code", ["USA", "1A", "U1", "", "U"])
async def test_holiday_sync_rejects_malformed_country(client, code):
    r = await client.post("/api/v1/holidays/sync", json={"country_code": code})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_holiday_sync_rejects_overlong_province(client):
    r = await client.post("/api/v1/holidays/sync", json={
        "country_code": "US", "province": "x" * 101,
    })
    assert r.status_code == 422


# ── Length limits ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_member_name_length_limit(client):
    r = await client.post("/api/v1/household/members", json={"name": "x" * 255})
    assert r.status_code == 201
    member_id = r.json()["id"]

    r = await client.post("/api/v1/household/members", json={"name": "x" * 256})
    assert r.status_code == 422

    r = await client.patch(
        f"/api/v1/household/members/{member_id}", json={"name": "x" * 256}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_member_color_length_limit(client):
    r = await client.post(
        "/api/v1/household/members", json={"name": "Ann", "color": "x" * 51}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_calendar_name_and_color_limits(client):
    r = await client.post("/api/v1/calendars", json={"name": "x" * 256})
    assert r.status_code == 422

    r = await client.post("/api/v1/calendars", json={"name": "Cal", "color": "x" * 51})
    assert r.status_code == 422

    cal_id = await _make_calendar(client)
    r = await client.patch(f"/api/v1/calendars/{cal_id}", json={"name": "x" * 256})
    assert r.status_code == 422

    r = await client.patch(f"/api/v1/calendars/{cal_id}", json={"color": "x" * 51})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_event_title_and_description_limits(client):
    cal_id = await _make_calendar(client)

    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "x" * 256, "start_at": START,
    })
    assert r.status_code == 422

    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "Event", "start_at": START,
        "description": "x" * 20001,
    })
    assert r.status_code == 422

    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "x" * 255, "start_at": START,
        "description": "x" * 20000,
    })
    assert r.status_code == 201
    event_id = r.json()["id"]

    r = await client.patch(f"/api/v1/events/{event_id}", json={"title": "x" * 256})
    assert r.status_code == 422

    r = await client.patch(
        f"/api/v1/events/{event_id}", json={"description": "x" * 20001}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_task_list_name_and_color_limits(client):
    r = await client.post("/api/v1/task-lists", json={"name": "x" * 256})
    assert r.status_code == 422

    r = await client.post(
        "/api/v1/task-lists", json={"name": "Chores", "color": "x" * 51}
    )
    assert r.status_code == 422

    r = await client.post("/api/v1/task-lists", json={"name": "Chores", "color": "sage"})
    assert r.status_code == 201
    list_id = r.json()["id"]

    r = await client.patch(f"/api/v1/task-lists/{list_id}", json={"name": "x" * 256})
    assert r.status_code == 422

    r = await client.patch(f"/api/v1/task-lists/{list_id}", json={"color": "x" * 51})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_task_title_and_description_limits(client):
    r = await client.post("/api/v1/task-lists", json={"name": "Chores", "color": "sage"})
    list_id = r.json()["id"]

    r = await client.post("/api/v1/tasks", json={
        "list_id": list_id, "title": "x" * 256,
    })
    assert r.status_code == 422

    r = await client.post("/api/v1/tasks", json={
        "list_id": list_id, "title": "Task", "description": "x" * 20001,
    })
    assert r.status_code == 422

    r = await client.post("/api/v1/tasks", json={
        "list_id": list_id, "title": "x" * 255, "description": "x" * 20000,
    })
    assert r.status_code == 201
    task_id = r.json()["id"]

    r = await client.patch(f"/api/v1/tasks/{task_id}", json={"title": "x" * 256})
    assert r.status_code == 422

    r = await client.patch(
        f"/api/v1/tasks/{task_id}", json={"description": "x" * 20001}
    )
    assert r.status_code == 422


# ── Reminder worker resilience ───────────────────────────────────────────────


def test_occurrences_tolerate_garbage_until():
    start = datetime(2030, 6, 3, 18, 0, tzinfo=UTC)
    ev = _event(start, {"freq": "daily", "until": "garbage"})

    occs = occurrences_between(ev, start, start + timedelta(days=3))
    assert occs == [start + timedelta(days=i) for i in range(4)]


@pytest.mark.parametrize("bad_until", ["garbage", 12345, {"date": "x"}, "2030-13-99"])
def test_occurrences_tolerate_non_date_until(bad_until):
    start = datetime(2030, 6, 3, 18, 0, tzinfo=UTC)
    ev = _event(start, {"freq": "weekly", "until": bad_until})

    occs = occurrences_between(ev, start, start + timedelta(days=14))
    assert occs == [start, start + timedelta(days=7), start + timedelta(days=14)]


@pytest.mark.parametrize("bad_count", ["nope", None, object()])
def test_occurrences_tolerate_garbage_count(bad_count):
    start = datetime(2030, 6, 3, 18, 0, tzinfo=UTC)
    ev = _event(start, {"freq": "daily", "count": bad_count})

    occs = occurrences_between(ev, start, start + timedelta(days=2))
    assert occs == [start + timedelta(days=i) for i in range(3)]


def test_occurrences_clamp_out_of_range_count():
    start = datetime(2030, 6, 3, 18, 0, tzinfo=UTC)

    # count=0 is clamped up to a single occurrence.
    zero = _event(start, {"freq": "daily", "count": 0})
    assert occurrences_between(zero, start, start + timedelta(days=3)) == [start]

    # count="3" is parsed as a number.
    stringy = _event(start, {"freq": "daily", "count": "3"})
    assert occurrences_between(stringy, start, start + timedelta(days=9)) == [
        start + timedelta(days=i) for i in range(3)
    ]

    # Huge counts are clamped rather than expanding forever.
    huge = _event(start, {"freq": "daily", "count": 10_000})
    assert len(occurrences_between(huge, start, start + timedelta(days=900))) == 400


def test_occurrences_still_honour_valid_until_and_count():
    start = datetime(2030, 6, 3, 18, 0, tzinfo=UTC)
    ev = _event(start, {"freq": "weekly", "until": "2030-06-17T18:00:00Z", "count": 2})

    assert occurrences_between(ev, start, start + timedelta(days=60)) == [
        start, start + timedelta(days=7),
    ]
