"""Tests for Web Push (VAPID) subscriptions and delivery."""
import base64
from datetime import datetime, timedelta, timezone

import pytest
from py_vapid import Vapid

from app.models.all import Calendar, Event, Household, PushSubscription, ServerSetting
from app.notifications.push import (
    DEFAULT_HOUSEHOLD_ID,
    deliver_push,
    generate_vapid_keys,
    get_vapid_keys,
    subscriptions_for,
)
from app.notifications.reminders import dispatch_due_reminders
from app.notifications.senders import push_message

UTC = timezone.utc


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


# ── VAPID keys ───────────────────────────────────────────────────────


def test_generate_vapid_keys_are_valid():
    public, private = generate_vapid_keys()

    assert len(_unb64(private)) == 32
    assert len(_unb64(public)) == 65
    assert _unb64(public)[0] == 4  # uncompressed EC point

    headers = Vapid.from_string(private).sign(
        {"sub": "mailto:a@b.com", "aud": "https://push.example.com"}
    )
    assert "Authorization" in headers


async def test_get_vapid_keys_persists_and_is_stable(db_session):
    public, private = await get_vapid_keys(db_session)
    assert await db_session.get(ServerSetting, "vapid") is not None

    again = await get_vapid_keys(db_session)
    assert again == (public, private)


async def test_get_vapid_keys_env_override_wins(db_session, monkeypatch):
    monkeypatch.setattr("app.notifications.push.settings.vapid_public_key", "PUB")
    monkeypatch.setattr("app.notifications.push.settings.vapid_private_key", "PRIV")
    assert await get_vapid_keys(db_session) == ("PUB", "PRIV")


# ── Message formatting ───────────────────────────────────────────────


def test_push_message_formats_when_and_lead():
    start = datetime(2030, 6, 1, 18, 0, tzinfo=UTC)
    title, body = push_message("Dinner", start, 30, tz_name="UTC")
    assert title == "Reminder: Dinner"
    assert "in 30 min" in body

    _, at_start = push_message("Dinner", start, 0, tz_name="UTC")
    assert "starting now" in at_start


# ── Subscriptions API ────────────────────────────────────────────────


async def test_subscribe_vapid_and_unsubscribe(client, db_session):
    payload = {
        "endpoint": "https://push.example.com/abc",
        "keys": {"p256dh": "p1", "auth": "a1"},
        "user_agent": "Test/1.0",
    }
    r = await client.post("/api/v1/push/subscribe", json=payload)
    assert r.status_code == 201

    # Re-subscribing with the same endpoint updates in place, no duplicate.
    payload["keys"]["p256dh"] = "p2"
    r = await client.post("/api/v1/push/subscribe", json=payload)
    assert r.status_code == 201

    subs = await subscriptions_for(db_session)
    assert len(subs) == 1
    assert subs[0].p256dh == "p2"

    r = await client.get("/api/v1/push/vapid-public-key")
    assert r.status_code == 200
    assert r.json()["key"]

    r = await client.post(
        "/api/v1/push/unsubscribe", json={"endpoint": payload["endpoint"]}
    )
    assert r.status_code == 200
    assert await subscriptions_for(db_session) == []

    # Unsubscribing an unknown endpoint is a harmless no-op.
    r = await client.post("/api/v1/push/unsubscribe", json={"endpoint": "https://gone"})
    assert r.status_code == 200


# ── Delivery ─────────────────────────────────────────────────────────


class _Gone:
    status_code = 410


async def test_deliver_push_sends_and_prunes_dead_endpoints(db_session, monkeypatch):
    from pywebpush import WebPushException

    live = PushSubscription(
        household_id=DEFAULT_HOUSEHOLD_ID, endpoint="https://live", p256dh="p", auth="a"
    )
    dead = PushSubscription(
        household_id=DEFAULT_HOUSEHOLD_ID, endpoint="https://dead", p256dh="p", auth="a"
    )
    db_session.add_all([live, dead])
    await db_session.commit()

    sent: list[str] = []

    async def fake_webpush(**kwargs):
        if kwargs["subscription_info"]["endpoint"] == "https://dead":
            raise WebPushException("gone", response=_Gone())
        sent.append(kwargs["subscription_info"]["endpoint"])
        return None

    monkeypatch.setattr("app.notifications.push.webpush_async", fake_webpush)

    ok, detail = await deliver_push(
        db_session, [live, dead], {"title": "hi"}, private_key="k", subject="mailto:a@b.com"
    )
    assert ok is True
    assert sent == ["https://live"]
    assert "pruned 1" in detail
    assert [s.endpoint for s in await subscriptions_for(db_session)] == ["https://live"]


async def test_deliver_push_no_subscriptions():
    ok, detail = await deliver_push(
        None, [], {"title": "hi"}, private_key="k", subject="mailto:a@b.com"
    )
    assert ok is False
    assert detail == "no push subscriptions"


# ── Reminder dispatch & test endpoint ────────────────────────────────


async def _seed_due_event(db_session):
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
        start_at=datetime.now(UTC) + timedelta(minutes=30),
        reminder_minutes=30,
        source="internal",
    )
    db_session.add(event)
    await db_session.commit()
    return event


async def test_dispatch_sends_push_when_device_subscribed(db_session, monkeypatch):
    await _seed_due_event(db_session)
    db_session.add(PushSubscription(
        household_id=DEFAULT_HOUSEHOLD_ID, endpoint="https://d1", p256dh="p", auth="a"
    ))
    await db_session.commit()

    payloads: list[dict] = []

    async def fake_webpush(**kwargs):
        import json

        payloads.append(json.loads(kwargs["data"]))
        return None

    monkeypatch.setattr("app.notifications.push.webpush_async", fake_webpush)

    logs = await dispatch_due_reminders(db_session, datetime.now(UTC))
    push_logs = [log for log in logs if log.channel == "push"]
    assert len(push_logs) == 1
    assert push_logs[0].status == "sent"
    assert payloads[0]["title"] == "Reminder: Soccer practice"
    assert payloads[0]["event_id"]


async def test_test_endpoint_pushes_to_devices(client, db_session, monkeypatch):
    db_session.add(PushSubscription(
        household_id=DEFAULT_HOUSEHOLD_ID, endpoint="https://d1", p256dh="p", auth="a"
    ))
    await db_session.commit()

    async def fake_webpush(**kwargs):
        return None

    monkeypatch.setattr("app.notifications.push.webpush_async", fake_webpush)

    r = await client.post("/api/v1/notifications/test", json={"channels": ["push"]})
    assert r.status_code == 200
    assert "sent to 1 device" in r.json()["results"]["push"]


async def test_test_endpoint_reports_no_devices(client):
    r = await client.post("/api/v1/notifications/test", json={"channels": ["push"]})
    assert r.status_code == 200
    assert "no devices" in r.json()["results"]["push"]


@pytest.mark.parametrize("status", [404, 410])
async def test_deliver_push_prunes_gone_statuses(db_session, monkeypatch, status):
    from pywebpush import WebPushException

    sub = PushSubscription(
        household_id=DEFAULT_HOUSEHOLD_ID, endpoint="https://d", p256dh="p", auth="a"
    )
    db_session.add(sub)
    await db_session.commit()

    class Resp:
        status_code = status

    async def fake_webpush(**kwargs):
        raise WebPushException("gone", response=Resp())

    monkeypatch.setattr("app.notifications.push.webpush_async", fake_webpush)

    ok, detail = await deliver_push(
        db_session, [sub], {"title": "hi"}, private_key="k", subject="mailto:a@b.com"
    )
    assert ok is False
    assert await subscriptions_for(db_session) == []
