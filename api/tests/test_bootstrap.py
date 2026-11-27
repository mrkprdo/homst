from datetime import date, datetime, timezone

from app.household import DEFAULT_HOUSEHOLD_ID
from app.models.all import Holiday, Photo


async def _create_calendar(client, name: str = "Personal") -> str:
    response = await client.post(
        "/api/v1/calendars",
        json={"name": name, "color": "sage", "source": "internal"},
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_bootstrap_returns_the_whole_household_in_one_response(client, db_session):
    member = await client.post("/api/v1/household/members", json={"name": "Ada"})
    assert member.status_code == 201
    member_id = member.json()["id"]

    calendar_id = await _create_calendar(client)
    event = await client.post(
        "/api/v1/events",
        json={
            "calendar_id": calendar_id,
            "title": "Dentist",
            "start_at": "2026-05-10T10:00:00Z",
        },
    )
    assert event.status_code == 201

    task_list = await client.post(
        "/api/v1/task-lists",
        json={"name": "Chores", "color": "sage", "position": 0},
    )
    assert task_list.status_code == 201
    task = await client.post(
        "/api/v1/tasks",
        json={"list_id": task_list.json()["id"], "title": "Vacuum"},
    )
    assert task.status_code == 201

    announcement = await client.post(
        "/api/v1/announcements",
        json={"message": "Dinner at seven", "created_by": member_id},
    )
    assert announcement.status_code == 201

    updated = await client.patch(
        "/api/v1/household/settings",
        json={"settings": {"houseName": "Casa", "isComplete": True}},
    )
    assert updated.status_code == 200

    db_session.add(
        Holiday(
            household_id=DEFAULT_HOUSEHOLD_ID,
            date=date(2026, 5, 1),
            name="May Day",
            country_code="US",
        )
    )
    db_session.add(Photo(household_id=DEFAULT_HOUSEHOLD_ID, filename="cover.jpg"))
    await db_session.commit()

    response = await client.get(
        "/api/v1/bootstrap", params={"from": "2026-05-01", "to": "2026-05-31"}
    )
    assert response.status_code == 200
    body = response.json()

    assert body["settings"]["houseName"] == "Casa"
    assert body["settings"]["isComplete"] is True
    assert [m["name"] for m in body["members"]] == ["Ada"]
    assert [c["name"] for c in body["calendars"]] == ["Personal"]
    assert [e["title"] for e in body["events"]] == ["Dentist"]
    assert [lst["name"] for lst in body["task_lists"]] == ["Chores"]
    assert [t["title"] for t in body["tasks"]] == ["Vacuum"]
    assert [h["name"] for h in body["holidays"]] == ["May Day"]
    assert [a["message"] for a in body["announcements"]] == ["Dinner at seven"]
    assert body["announcements"][0]["author_name"] == "Ada"
    assert body["photos"][0]["url"] == "/uploads/photos/cover.jpg"


async def test_bootstrap_defaults_to_the_month_before_and_after(client):
    calendar_id = await _create_calendar(client)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    event = await client.post(
        "/api/v1/events",
        json={
            "calendar_id": calendar_id,
            "title": "Today",
            "start_at": now.isoformat(),
        },
    )
    assert event.status_code == 201

    response = await client.get("/api/v1/bootstrap")
    assert response.status_code == 200
    assert [e["title"] for e in response.json()["events"]] == ["Today"]


async def test_bootstrap_accepts_a_partial_range(client):
    await _create_calendar(client)
    response = await client.get("/api/v1/bootstrap", params={"from": "2026-01-01"})
    assert response.status_code == 200
    assert response.json()["calendars"][0]["name"] == "Personal"
