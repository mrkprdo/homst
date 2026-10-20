import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.all import Announcement, PushSubscription


async def _create_member(client, name="Alice"):
    r = await client.post("/api/v1/household/members", json={"name": name})
    assert r.status_code == 201
    return r.json()


@pytest.mark.asyncio
async def test_create_and_list_announcement(client):
    member = await _create_member(client)

    r = await client.post(
        "/api/v1/announcements",
        json={
            "message": "  Dinner is ready  ",
            "created_by": member["id"],
            "duration_minutes": 30,
            "send_push": False,
        },
    )
    assert r.status_code == 201
    data = r.json()
    assert data["message"] == "Dinner is ready"
    assert data["author_name"] == "Alice"
    assert data["created_by"] == member["id"]
    assert data["expires_at"] is not None

    r = await client.get("/api/v1/announcements")
    assert r.status_code == 200
    listed = r.json()
    assert [a["id"] for a in listed] == [data["id"]]
    assert listed[0]["author_name"] == "Alice"


@pytest.mark.asyncio
async def test_announcements_are_newest_first(client):
    for message in ("First", "Second", "Third"):
        r = await client.post(
            "/api/v1/announcements",
            json={"message": message, "duration_minutes": None, "send_push": False},
        )
        assert r.status_code == 201

    r = await client.get("/api/v1/announcements")
    assert [a["message"] for a in r.json()] == ["Third", "Second", "First"]


@pytest.mark.asyncio
async def test_announcement_without_duration_never_expires(client):
    r = await client.post(
        "/api/v1/announcements",
        json={"message": "Keep me", "duration_minutes": None, "send_push": False},
    )
    assert r.status_code == 201
    assert r.json()["expires_at"] is None
    assert r.json()["author_name"] is None


@pytest.mark.asyncio
async def test_expired_announcements_are_hidden(client, db_session):
    r = await client.post(
        "/api/v1/announcements",
        json={"message": "Old news", "duration_minutes": 30, "send_push": False},
    )
    assert r.status_code == 201

    announcement = (await db_session.execute(select(Announcement))).scalar_one()
    announcement.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db_session.commit()

    r = await client.get("/api/v1/announcements")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_announcement_mutations_broadcast_to_the_fleet(client, monkeypatch):
    from app.routers import announcements as announcements_router

    calls: list[tuple[str, str, dict]] = []

    async def fake_publish(household_id, event_type, data):
        calls.append((household_id, event_type, data))

    monkeypatch.setattr(announcements_router, "publish_event", fake_publish)

    r = await client.post(
        "/api/v1/announcements",
        json={"message": "Everyone out", "duration_minutes": 15, "send_push": False},
    )
    assert r.status_code == 201
    announcement_id = r.json()["id"]

    r = await client.delete(f"/api/v1/announcements/{announcement_id}")
    assert r.status_code == 200

    assert [c[1] for c in calls] == ["announcement.created", "announcement.deleted"]
    assert calls[0][2]["id"] == announcement_id
    assert calls[0][2]["message"] == "Everyone out"
    assert calls[1][2] == {"id": announcement_id}


@pytest.mark.asyncio
async def test_deleting_an_author_keeps_the_announcement(client):
    member = await _create_member(client, "Temp Author")
    r = await client.post(
        "/api/v1/announcements",
        json={
            "message": "Still here",
            "created_by": member["id"],
            "duration_minutes": None,
            "send_push": False,
        },
    )
    assert r.status_code == 201

    r = await client.delete(f"/api/v1/household/members/{member['id']}")
    assert r.status_code == 200

    r = await client.get("/api/v1/announcements")
    assert len(r.json()) == 1
    assert r.json()[0]["message"] == "Still here"
    assert r.json()[0]["created_by"] is None
    assert r.json()[0]["author_name"] is None


@pytest.mark.asyncio
async def test_announcement_push_opens_the_message(client, db_session, monkeypatch):
    db_session.add(
        PushSubscription(
            household_id="00000000-0000-0000-0000-000000000000",
            endpoint="https://push.example/device",
            p256dh="p",
            auth="a",
        )
    )
    await db_session.commit()

    payloads: list[dict] = []

    async def fake_webpush(**kwargs):
        payloads.append(json.loads(kwargs["data"]))

    monkeypatch.setattr("app.notifications.push.webpush_async", fake_webpush)

    r = await client.post(
        "/api/v1/announcements",
        json={"message": "Dinner is ready", "duration_minutes": 30, "send_push": True},
    )
    assert r.status_code == 201
    announcement_id = r.json()["id"]

    assert len(payloads) == 1
    assert payloads[0]["body"] == "Dinner is ready"
    assert payloads[0]["url"] == f"/?announcement={announcement_id}"
    assert payloads[0]["tag"] == f"announcement:{announcement_id}"


@pytest.mark.asyncio
async def test_delete_announcement_missing(client):
    r = await client.delete("/api/v1/announcements/00000000-0000-0000-0000-000000000099")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_announcement_requires_a_message(client):
    r = await client.post(
        "/api/v1/announcements",
        json={"message": "   ", "send_push": False},
    )
    assert r.status_code == 422

    r = await client.post(
        "/api/v1/announcements",
        json={"message": "", "send_push": False},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_announcement_rejects_unknown_author(client):
    r = await client.post(
        "/api/v1/announcements",
        json={
            "message": "Hello",
            "created_by": "00000000-0000-0000-0000-000000000099",
            "send_push": False,
        },
    )
    assert r.status_code == 404
