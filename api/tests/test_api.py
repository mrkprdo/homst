import pytest
from fastapi import HTTPException


# ── Health ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# ── Members ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_members_empty(client):
    r = await client.get("/api/v1/household/members")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_create_member(client):
    r = await client.post("/api/v1/household/members", json={"name": "Alice", "role": "admin"})
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Alice"
    assert data["role"] == "admin"
    assert "id" in data
    assert "joined_at" in data


@pytest.mark.asyncio
async def test_create_member_default_role(client):
    r = await client.post("/api/v1/household/members", json={"name": "Bob"})
    assert r.status_code == 201
    assert r.json()["role"] == "member"


@pytest.mark.asyncio
async def test_create_member_with_avatar(client):
    r = await client.post("/api/v1/household/members", json={
        "name": "Carol", "avatar_url": "https://example.com/avatar.png"
    })
    assert r.status_code == 201
    assert r.json()["avatar_url"] == "https://example.com/avatar.png"


@pytest.mark.asyncio
async def test_list_members_returns_all(client):
    await client.post("/api/v1/household/members", json={"name": "Alice"})
    await client.post("/api/v1/household/members", json={"name": "Bob"})
    r = await client.get("/api/v1/household/members")
    assert r.status_code == 200
    assert len(r.json()) == 2


@pytest.mark.asyncio
async def test_update_member_name(client):
    r = await client.post("/api/v1/household/members", json={"name": "Bob"})
    member_id = r.json()["id"]

    r = await client.patch(f"/api/v1/household/members/{member_id}", json={"name": "Bobby"})
    assert r.status_code == 200
    assert r.json()["name"] == "Bobby"


@pytest.mark.asyncio
async def test_update_member_role(client):
    r = await client.post("/api/v1/household/members", json={"name": "Bob"})
    member_id = r.json()["id"]

    r = await client.patch(f"/api/v1/household/members/{member_id}", json={"role": "admin"})
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


@pytest.mark.asyncio
async def test_update_member_not_found(client):
    r = await client.patch(
        "/api/v1/household/members/00000000-0000-0000-0000-000000000099",
        json={"name": "Ghost"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_member(client):
    r = await client.post("/api/v1/household/members", json={"name": "To Delete"})
    member_id = r.json()["id"]

    r = await client.delete(f"/api/v1/household/members/{member_id}")
    assert r.status_code == 200

    r = await client.get("/api/v1/household/members")
    assert all(m["id"] != member_id for m in r.json())


@pytest.mark.asyncio
async def test_member_mutations_broadcast_to_the_fleet(client, monkeypatch):
    """Member changes must reach other connected clients over SSE."""
    from app.routers import users as users_router

    calls: list[tuple[str, str, dict]] = []

    async def fake_publish(household_id, event_type, data):
        calls.append((household_id, event_type, data))

    monkeypatch.setattr(users_router, "publish_event", fake_publish)

    r = await client.post("/api/v1/household/members", json={"name": "Zoe"})
    assert r.status_code == 201
    member_id = r.json()["id"]

    r = await client.patch(f"/api/v1/household/members/{member_id}", json={"name": "Zoë"})
    assert r.status_code == 200

    r = await client.delete(f"/api/v1/household/members/{member_id}")
    assert r.status_code == 200

    assert [c[1] for c in calls] == ["member.joined", "member.updated", "member.removed"]
    joined = calls[0][2]
    assert joined["id"] == member_id
    assert joined["name"] == "Zoe"
    updated = calls[1][2]
    assert updated["name"] == "Zoë"
    assert calls[2][2] == {"id": member_id}


@pytest.mark.asyncio
async def test_delete_member_not_found(client):
    r = await client.delete("/api/v1/household/members/00000000-0000-0000-0000-000000000099")
    assert r.status_code == 404


# ── Calendars ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_calendar(client):
    r = await client.post("/api/v1/calendars", json={
        "name": "Family", "color": "sage", "source": "internal"
    })
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Family"
    assert data["color"] == "sage"
    assert data["source"] == "internal"
    assert data["is_visible"] is True


@pytest.mark.asyncio
async def test_list_calendars(client):
    await client.post("/api/v1/calendars", json={"name": "Cal 1", "color": "peach", "source": "internal"})
    await client.post("/api/v1/calendars", json={"name": "Cal 2", "color": "sky", "source": "internal"})
    r = await client.get("/api/v1/calendars")
    assert r.status_code == 200
    assert len(r.json()) == 2


@pytest.mark.asyncio
async def test_update_calendar(client):
    r = await client.post("/api/v1/calendars", json={"name": "Old", "color": "sage", "source": "internal"})
    cal_id = r.json()["id"]

    r = await client.patch(f"/api/v1/calendars/{cal_id}", json={"name": "Updated", "is_visible": False})
    assert r.status_code == 200
    assert r.json()["name"] == "Updated"
    assert r.json()["is_visible"] is False


@pytest.mark.asyncio
async def test_delete_calendar(client):
    r = await client.post("/api/v1/calendars", json={"name": "Bye", "color": "mauve", "source": "internal"})
    cal_id = r.json()["id"]

    r = await client.delete(f"/api/v1/calendars/{cal_id}")
    assert r.status_code == 200

    r = await client.get("/api/v1/calendars")
    assert all(c["id"] != cal_id for c in r.json())


@pytest.mark.asyncio
async def test_subscribe_calendar(client):
    r = await client.post("/api/v1/calendars/subscribe", json={
        "feed_url": "https://example.com/cal.ics", "name": "Subscribed"
    })
    assert r.status_code == 201
    assert r.json()["source"] == "ical"
    assert r.json()["feed_url"] == "https://example.com/cal.ics"


# ── Events ───────────────────────────────────────────────────────────────────

async def _make_calendar(client, name="Cal"):
    r = await client.post("/api/v1/calendars", json={"name": name, "color": "sage", "source": "internal"})
    return r.json()["id"]


@pytest.mark.asyncio
async def test_create_event(client):
    cal_id = await _make_calendar(client)
    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "Dinner",
        "start_at": "2026-05-03T18:00:00Z",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "Dinner"
    assert data["source"] == "internal"


@pytest.mark.asyncio
async def test_create_event_with_end(client):
    cal_id = await _make_calendar(client)
    r = await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "Meeting",
        "start_at": "2026-05-03T10:00:00Z", "end_at": "2026-05-03T11:00:00Z",
    })
    assert r.status_code == 201
    assert r.json()["end_at"] is not None


@pytest.mark.asyncio
async def test_create_event_unknown_calendar(client):
    r = await client.post("/api/v1/events", json={
        "calendar_id": "00000000-0000-0000-0000-000000000099",
        "title": "Orphan", "start_at": "2026-05-03T10:00:00Z",
    })
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_events(client):
    cal_id = await _make_calendar(client)
    await client.post("/api/v1/events", json={"calendar_id": cal_id, "title": "E1", "start_at": "2026-05-01T10:00:00Z"})
    await client.post("/api/v1/events", json={"calendar_id": cal_id, "title": "E2", "start_at": "2026-05-02T10:00:00Z"})
    r = await client.get("/api/v1/events")
    assert r.status_code == 200
    assert len(r.json()) == 2


@pytest.mark.asyncio
async def test_list_events_date_filter(client):
    cal_id = await _make_calendar(client)
    await client.post("/api/v1/events", json={"calendar_id": cal_id, "title": "May", "start_at": "2026-05-15T10:00:00Z"})
    await client.post("/api/v1/events", json={"calendar_id": cal_id, "title": "June", "start_at": "2026-06-01T10:00:00Z"})

    r = await client.get("/api/v1/events?from=2026-06-01")
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["title"] == "June"


@pytest.mark.asyncio
async def test_update_event(client):
    cal_id = await _make_calendar(client)
    r = await client.post("/api/v1/events", json={"calendar_id": cal_id, "title": "Old", "start_at": "2026-05-03T10:00:00Z"})
    ev_id = r.json()["id"]

    r = await client.patch(f"/api/v1/events/{ev_id}", json={"title": "New", "all_day": True})
    assert r.status_code == 200
    assert r.json()["title"] == "New"
    assert r.json()["all_day"] is True


@pytest.mark.asyncio
async def test_delete_event(client):
    cal_id = await _make_calendar(client)
    r = await client.post("/api/v1/events", json={"calendar_id": cal_id, "title": "Bye", "start_at": "2026-05-03T10:00:00Z"})
    ev_id = r.json()["id"]

    r = await client.delete(f"/api/v1/events/{ev_id}")
    assert r.status_code == 200

    r = await client.get("/api/v1/events")
    assert len(r.json()) == 0


# ── Task Lists ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_task_list(client):
    r = await client.post("/api/v1/task-lists", json={"name": "Chores", "color": "taupe", "position": 0})
    assert r.status_code == 201
    assert r.json()["name"] == "Chores"
    assert r.json()["color"] == "taupe"


@pytest.mark.asyncio
async def test_list_task_lists(client):
    await client.post("/api/v1/task-lists", json={"name": "List A", "color": "taupe", "position": 0})
    await client.post("/api/v1/task-lists", json={"name": "List B", "color": "taupe", "position": 1})
    r = await client.get("/api/v1/task-lists")
    assert r.status_code == 200
    assert len(r.json()) == 2


@pytest.mark.asyncio
async def test_update_task_list(client):
    r = await client.post("/api/v1/task-lists", json={"name": "Old", "color": "taupe", "position": 0})
    list_id = r.json()["id"]

    r = await client.patch(f"/api/v1/task-lists/{list_id}", json={"name": "New"})
    assert r.status_code == 200
    assert r.json()["name"] == "New"


@pytest.mark.asyncio
async def test_delete_task_list(client):
    r = await client.post("/api/v1/task-lists", json={"name": "Bye", "color": "taupe", "position": 0})
    list_id = r.json()["id"]

    r = await client.delete(f"/api/v1/task-lists/{list_id}")
    assert r.status_code == 200

    r = await client.get("/api/v1/task-lists")
    assert all(l["id"] != list_id for l in r.json())


# ── Tasks ────────────────────────────────────────────────────────────────────

async def _make_list(client, name="Work"):
    r = await client.post("/api/v1/task-lists", json={"name": name, "color": "taupe", "position": 0})
    return r.json()["id"]


@pytest.mark.asyncio
async def test_create_task(client):
    list_id = await _make_list(client)
    r = await client.post("/api/v1/tasks", json={
        "list_id": list_id, "title": "Buy milk", "priority": "low",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "Buy milk"
    assert data["status"] == "todo"
    assert data["priority"] == "low"


@pytest.mark.asyncio
async def test_create_task_with_dates(client):
    list_id = await _make_list(client)
    r = await client.post("/api/v1/tasks", json={
        "list_id": list_id, "title": "Meeting",
        "start_at": "2026-05-10T09:00:00Z", "end_at": "2026-05-10T10:00:00Z",
    })
    assert r.status_code == 201
    assert r.json()["start_at"] is not None
    assert r.json()["end_at"] is not None


@pytest.mark.asyncio
async def test_create_task_unknown_list(client):
    r = await client.post("/api/v1/tasks", json={
        "list_id": "00000000-0000-0000-0000-000000000099", "title": "Orphan",
    })
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_tasks(client):
    list_id = await _make_list(client)
    await client.post("/api/v1/tasks", json={"list_id": list_id, "title": "T1"})
    await client.post("/api/v1/tasks", json={"list_id": list_id, "title": "T2"})
    r = await client.get("/api/v1/tasks")
    assert r.status_code == 200
    assert len(r.json()) == 2


@pytest.mark.asyncio
async def test_list_tasks_filter_by_list(client):
    list_a = await _make_list(client, "A")
    list_b = await _make_list(client, "B")
    await client.post("/api/v1/tasks", json={"list_id": list_a, "title": "A task"})
    await client.post("/api/v1/tasks", json={"list_id": list_b, "title": "B task"})

    r = await client.get(f"/api/v1/tasks?list_id={list_a}")
    assert len(r.json()) == 1
    assert r.json()[0]["title"] == "A task"


@pytest.mark.asyncio
async def test_update_task(client):
    list_id = await _make_list(client)
    r = await client.post("/api/v1/tasks", json={"list_id": list_id, "title": "Draft"})
    task_id = r.json()["id"]

    r = await client.patch(f"/api/v1/tasks/{task_id}", json={"title": "Done", "status": "done"})
    assert r.status_code == 200
    assert r.json()["title"] == "Done"
    assert r.json()["status"] == "done"


@pytest.mark.asyncio
async def test_update_task_dates(client):
    list_id = await _make_list(client)
    r = await client.post("/api/v1/tasks", json={"list_id": list_id, "title": "Schedule"})
    task_id = r.json()["id"]

    r = await client.patch(f"/api/v1/tasks/{task_id}", json={"start_at": "2026-06-01T09:00:00Z"})
    assert r.status_code == 200
    assert r.json()["start_at"] is not None


@pytest.mark.asyncio
async def test_move_task(client):
    list_a = await _make_list(client, "A")
    list_b = await _make_list(client, "B")
    r = await client.post("/api/v1/tasks", json={"list_id": list_a, "title": "Move me"})
    task_id = r.json()["id"]

    r = await client.patch(f"/api/v1/tasks/{task_id}/move", json={"list_id": list_b, "position": 0})
    assert r.status_code == 200
    assert r.json()["list_id"] == list_b


@pytest.mark.asyncio
async def test_update_event_not_found(client):
    r = await client.patch(
        "/api/v1/events/00000000-0000-0000-0000-000000000099",
        json={"title": "Ghost"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_event_not_found(client):
    r = await client.delete("/api/v1/events/00000000-0000-0000-0000-000000000099")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_update_calendar_not_found(client):
    r = await client.patch(
        "/api/v1/calendars/00000000-0000-0000-0000-000000000099",
        json={"name": "Ghost"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_calendar_not_found(client):
    r = await client.delete("/api/v1/calendars/00000000-0000-0000-0000-000000000099")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_calendars_empty(client):
    r = await client.get("/api/v1/calendars")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_delete_member_nullifies_assignee_id(client):
    r = await client.post("/api/v1/household/members", json={"name": "Assignee"})
    member_id = r.json()["id"]

    list_id = await _make_list(client)
    await client.post("/api/v1/tasks", json={
        "list_id": list_id, "title": "Assigned task",
        "assignee_id": member_id,
    })

    cal_id = await _make_calendar(client)
    await client.post("/api/v1/events", json={
        "calendar_id": cal_id, "title": "Assigned event",
        "start_at": "2026-05-03T10:00:00Z",
        "assignee_id": member_id,
    })

    r = await client.delete(f"/api/v1/household/members/{member_id}")
    assert r.status_code == 200

    r = await client.get("/api/v1/tasks")
    assert all(t["assignee_id"] is None for t in r.json())

    r = await client.get("/api/v1/events")
    assert all(e["assignee_id"] is None for e in r.json())


@pytest.mark.asyncio
async def test_delete_task(client):
    list_id = await _make_list(client)
    r = await client.post("/api/v1/tasks", json={"list_id": list_id, "title": "Bye"})
    task_id = r.json()["id"]

    r = await client.delete(f"/api/v1/tasks/{task_id}")
    assert r.status_code == 200

    r = await client.get("/api/v1/tasks")
    assert all(t["id"] != task_id for t in r.json())


@pytest.mark.asyncio
async def test_delete_task_list_cascades_tasks(client):
    list_id = await _make_list(client)
    await client.post("/api/v1/tasks", json={"list_id": list_id, "title": "T1"})
    await client.post("/api/v1/tasks", json={"list_id": list_id, "title": "T2"})

    await client.delete(f"/api/v1/task-lists/{list_id}")
    r = await client.get("/api/v1/tasks")
    assert len(r.json()) == 0


# ── Settings ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_settings(client):
    r = await client.get("/api/v1/household/settings")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_update_settings(client):
    r = await client.patch("/api/v1/household/settings", json={"settings": {"theme": "dark"}})
    assert r.status_code == 200

    r = await client.get("/api/v1/household/settings")
    assert r.json().get("theme") == "dark"


# ── Holidays ─────────────────────────────────────────────────────────────────

def _mock_nager_2026():
    return [
        {"date": "2026-01-01", "localName": "New Year's Day", "name": "New Year's Day",
         "countryCode": "US", "fixed": True, "global": True, "counties": None, "types": ["Public"]},
        {"date": "2026-07-04", "localName": "Independence Day", "name": "Independence Day",
         "countryCode": "US", "fixed": True, "global": True, "counties": None, "types": ["Public"]},
        {"date": "2026-12-25", "localName": "Christmas Day", "name": "Christmas Day",
         "countryCode": "US", "fixed": True, "global": True, "counties": None, "types": ["Public"]},
    ]


def _mock_nager_2027():
    return [
        {"date": "2027-01-01", "localName": "New Year's Day", "name": "New Year's Day",
         "countryCode": "US", "fixed": True, "global": True, "counties": None, "types": ["Public"]},
        {"date": "2027-07-04", "localName": "Independence Day", "name": "Independence Day",
         "countryCode": "US", "fixed": True, "global": True, "counties": None, "types": ["Public"]},
    ]


@pytest.mark.asyncio
async def test_list_holidays_empty(client):
    r = await client.get("/api/v1/holidays")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_sync_holidays(client, monkeypatch):
    async def mock_fetch(year, country_code):
        if year == 2026:
            return _mock_nager_2026()
        return _mock_nager_2027()
    monkeypatch.setattr("app.routers.holidays._fetch_nager_holidays", mock_fetch)

    r = await client.post("/api/v1/holidays/sync", json={"country_code": "US"})
    assert r.status_code == 201
    assert "Synced" in r.json()["message"]

    r = await client.get("/api/v1/holidays")
    holidays = r.json()
    assert len(holidays) == 5
    for h in holidays:
        assert h["country_code"] == "US"
        assert "id" in h
        assert "date" in h


@pytest.mark.asyncio
async def test_sync_holidays_replaces_existing(client, monkeypatch):
    async def mock_fetch(year, country_code):
        if country_code == "CA":
            return [{"date": str(year) + "-07-01", "localName": "Canada Day", "name": "Canada Day",
                     "countryCode": "CA", "fixed": True, "global": True, "counties": None, "types": ["Public"]}]
        if year == 2026:
            return _mock_nager_2026()
        return _mock_nager_2027()
    monkeypatch.setattr("app.routers.holidays._fetch_nager_holidays", mock_fetch)

    await client.post("/api/v1/holidays/sync", json={"country_code": "US"})
    r1 = await client.get("/api/v1/holidays")
    assert len(r1.json()) == 5

    await client.post("/api/v1/holidays/sync", json={"country_code": "CA"})
    r2 = await client.get("/api/v1/holidays")
    holidays = r2.json()
    assert len(holidays) == 2
    assert all(h["country_code"] == "CA" for h in holidays)


@pytest.mark.asyncio
async def test_sync_holidays_with_province(client, monkeypatch):
    async def mock_fetch(year, country_code):
        return [
            {"date": str(year) + "-01-01", "localName": "NY Day", "name": "NY Day",
             "countryCode": "US", "fixed": True, "global": False,
             "counties": ["US-CA", "US-NY"], "types": ["Public"]},
            {"date": str(year) + "-06-15", "localName": "State Holiday", "name": "State Holiday",
             "countryCode": "US", "fixed": True, "global": False,
             "counties": ["US-TX"], "types": ["Public"]},
        ]
    monkeypatch.setattr("app.routers.holidays._fetch_nager_holidays", mock_fetch)

    r = await client.post("/api/v1/holidays/sync", json={
        "country_code": "US", "province": "CA",
    })
    assert r.status_code == 201

    r = await client.get("/api/v1/holidays")
    holidays = r.json()
    assert len(holidays) == 2  # 1 from 2026, 1 from 2027
    assert all(h["name"] == "NY Day" for h in holidays)


@pytest.mark.asyncio
async def test_sync_holidays_without_province_includes_all(client, monkeypatch):
    async def mock_fetch(year, country_code):
        return [
            {"date": str(year) + "-01-01", "localName": "National Holiday", "name": "National Holiday",
             "countryCode": "US", "fixed": True, "global": True, "counties": None, "types": ["Public"]},
            {"date": str(year) + "-06-15", "localName": "Local Only", "name": "Local Only",
             "countryCode": "US", "fixed": True, "global": False,
             "counties": ["US-TX"], "types": ["Public"]},
        ]
    monkeypatch.setattr("app.routers.holidays._fetch_nager_holidays", mock_fetch)

    r = await client.post("/api/v1/holidays/sync", json={"country_code": "US"})
    assert r.status_code == 201

    r = await client.get("/api/v1/holidays")
    holidays = r.json()
    # Without province filter, ALL holidays are included (even county-specific ones)
    assert len(holidays) == 4  # 2 per year × 2 years
    names = {h["name"] for h in holidays}
    assert "National Holiday" in names
    assert "Local Only" in names


@pytest.mark.asyncio
async def test_sync_holidays_api_error_returns_502(client, monkeypatch):
    async def mock_fetch(year, country_code):
        raise HTTPException(status_code=502, detail="Nager.Date API error: 500")
    monkeypatch.setattr("app.routers.holidays._fetch_nager_holidays", mock_fetch)

    r = await client.post("/api/v1/holidays/sync", json={"country_code": "INVALID"})
    assert r.status_code == 502


@pytest.mark.asyncio
async def test_sync_holidays_network_error_returns_502(client, monkeypatch):
    async def mock_fetch(year, country_code):
        raise HTTPException(status_code=502, detail="Nager.Date API unavailable")
    monkeypatch.setattr("app.routers.holidays._fetch_nager_holidays", mock_fetch)

    r = await client.post("/api/v1/holidays/sync", json={"country_code": "US"})
    assert r.status_code == 502


@pytest.mark.asyncio
async def test_sync_holidays_same_country_twice_no_duplicates(client, monkeypatch):
    async def mock_fetch(year, country_code):
        if year == 2026:
            return _mock_nager_2026()
        return _mock_nager_2027()
    monkeypatch.setattr("app.routers.holidays._fetch_nager_holidays", mock_fetch)

    await client.post("/api/v1/holidays/sync", json={"country_code": "US"})
    await client.post("/api/v1/holidays/sync", json={"country_code": "US"})
    r = await client.get("/api/v1/holidays")
    # Should still be 5, not 10 — sync replaces all
    assert len(r.json()) == 5


@pytest.mark.asyncio
async def test_holidays_response_has_all_expected_fields(client, monkeypatch):
    async def mock_fetch(year, country_code):
        return [{"date": str(year) + "-01-01", "localName": "New Year", "name": "New Year",
                 "countryCode": "US", "fixed": True, "global": True, "counties": None, "types": ["Public"]}]
    monkeypatch.setattr("app.routers.holidays._fetch_nager_holidays", mock_fetch)

    await client.post("/api/v1/holidays/sync", json={"country_code": "US"})
    r = await client.get("/api/v1/holidays")
    h = r.json()[0]
    assert "id" in h
    assert "household_id" in h
    assert "date" in h
    assert "name" in h
    assert "local_name" in h
    assert "country_code" in h
    assert "province" in h
    assert "created_at" in h
    assert h["country_code"] == "US"
    assert h["local_name"] == "New Year"


@pytest.mark.asyncio
async def test_update_settings_merge(client):
    await client.patch("/api/v1/household/settings", json={"settings": {"a": 1}})
    await client.patch("/api/v1/household/settings", json={"settings": {"b": 2}})
    r = await client.get("/api/v1/household/settings")
    data = r.json()
    assert data.get("a") == 1
    assert data.get("b") == 2


@pytest.mark.asyncio
async def test_settings_and_members_onboarding_flow(client):
    """Simulates the onboarding flow: create members + save settings, then read back."""
    r = await client.post("/api/v1/household/members", json={"name": "Alice", "role": "member"})
    assert r.status_code == 201
    alice_id = r.json()["id"]

    r = await client.post("/api/v1/household/members", json={"name": "Bob", "role": "member"})
    assert r.status_code == 201
    bob_id = r.json()["id"]

    r = await client.patch("/api/v1/household/settings", json={
        "settings": {"houseName": "My Home", "address": "123 Main St", "isComplete": True},
    })
    assert r.status_code == 200

    # Verify members
    r = await client.get("/api/v1/household/members")
    members = r.json()
    assert len(members) == 2
    names = {m["name"] for m in members}
    assert "Alice" in names
    assert "Bob" in names

    # Verify settings
    r = await client.get("/api/v1/household/settings")
    settings = r.json()
    assert settings.get("houseName") == "My Home"
    assert settings.get("address") == "123 Main St"
    assert settings.get("isComplete") is True


@pytest.mark.asyncio
async def test_get_settings_defaults_to_empty(client):
    r = await client.get("/api/v1/household/settings")
    assert r.status_code == 200
    assert r.json() == {}


@pytest.mark.asyncio
async def test_settings_preserves_existing_keys(client):
    await client.patch("/api/v1/household/settings", json={"settings": {"theme": "dark"}})
    await client.patch("/api/v1/household/settings", json={"settings": {"fontSize": "large"}})
    r = await client.get("/api/v1/household/settings")
    data = r.json()
    assert data.get("theme") == "dark"
    assert data.get("fontSize") == "large"
