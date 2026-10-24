"""Security tests for Web Push endpoints (SSRF guards and abuse limits)."""
import pytest

from app.models.all import PushSubscription
from app.notifications.push import (
    DEFAULT_HOUSEHOLD_ID,
    deliver_push,
    validate_push_endpoint,
)
from app.routers import push as push_router

VALID_ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc"


def _payload(
    endpoint: str = VALID_ENDPOINT,
    *,
    p256dh: str = "p",
    auth: str = "a",
    user_agent: str | None = None,
) -> dict:
    payload = {"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}}
    if user_agent is not None:
        payload["user_agent"] = user_agent
    return payload


# ── Endpoint validation ──────────────────────────────────────────────


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://fcm.googleapis.com/fcm/send/abc",
        "https://eu.fcm.googleapis.com/fcm/send/def",  # suffix match
        "https://FCM.GoogleAPIs.com/fcm/send/ghi",  # hostname is case-insensitive
        "https://fcm.googleapis.com:443/fcm/send/jkl",
    ],
)
def test_validate_push_endpoint_accepts_allowlisted_services(endpoint):
    validate_push_endpoint(endpoint)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/fcm/send/abc",
        "https://localhost/push",
        "https://127.0.0.1/push",
        "https://192.168.1.10/push",
        "https://evil.example.com/push",
        "https://fcm.googleapis.com.evil.com/push",  # suffix spoof
        "https://user:pass@fcm.googleapis.com/push",
        "https://fcm.googleapis.com:8443/push",
        "https://fcm.googleapis.com:notaport/push",
        "https:///missing-host",
        "https://fcm.googleapis.com/" + "a" * 2048,
    ],
)
def test_validate_push_endpoint_rejects_unsafe_urls(endpoint):
    with pytest.raises(ValueError):
        validate_push_endpoint(endpoint)


# ── Subscribe endpoint ───────────────────────────────────────────────


async def test_subscribe_accepts_fcm_endpoint(client):
    r = await client.post("/api/v1/push/subscribe", json=_payload())
    assert r.status_code == 201


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/fcm/send/abc",
        "https://localhost/push",
        "https://127.0.0.1/push",
        "https://10.0.0.5/push",
        "https://unknown.example.com/push",
        "https://user:pass@fcm.googleapis.com/push",
        "https://fcm.googleapis.com:8443/push",
    ],
)
async def test_subscribe_rejects_unsafe_endpoints(client, endpoint):
    r = await client.post("/api/v1/push/subscribe", json=_payload(endpoint))
    assert r.status_code == 422
    assert "push endpoint" in r.json()["detail"].lower()


async def test_subscribe_rejects_too_long_endpoint(client):
    endpoint = "https://fcm.googleapis.com/" + "a" * 2048
    r = await client.post("/api/v1/push/subscribe", json=_payload(endpoint))
    assert r.status_code == 422


@pytest.mark.parametrize(
    "override",
    [
        {"p256dh": "p" * 513},
        {"auth": "a" * 513},
        {"user_agent": "u" * 256},
    ],
)
async def test_subscribe_rejects_oversized_keys(client, override):
    r = await client.post("/api/v1/push/subscribe", json=_payload(**override))
    assert r.status_code == 422


async def test_subscribe_accepts_keys_at_the_limit(client):
    r = await client.post(
        "/api/v1/push/subscribe",
        json=_payload(p256dh="p" * 512, auth="a" * 512, user_agent="u" * 255),
    )
    assert r.status_code == 201


async def test_subscribe_caps_new_endpoints(client, monkeypatch):
    monkeypatch.setattr(push_router, "MAX_SUBSCRIPTIONS", 1)

    first = _payload("https://fcm.googleapis.com/fcm/send/one")
    assert (await client.post("/api/v1/push/subscribe", json=first)).status_code == 201

    second = _payload("https://fcm.googleapis.com/fcm/send/two")
    r = await client.post("/api/v1/push/subscribe", json=second)
    assert r.status_code == 429

    # Refreshing an already-registered endpoint is still allowed.
    first["keys"]["p256dh"] = "p2"
    r = await client.post("/api/v1/push/subscribe", json=first)
    assert r.status_code == 201


# ── Delivery ─────────────────────────────────────────────────────────


async def test_deliver_push_skips_invalid_stored_endpoint(db_session, monkeypatch):
    good = PushSubscription(
        household_id=DEFAULT_HOUSEHOLD_ID,
        endpoint="https://fcm.googleapis.com/fcm/send/good",
        p256dh="p",
        auth="a",
    )
    bad = PushSubscription(
        household_id=DEFAULT_HOUSEHOLD_ID,
        endpoint="http://127.0.0.1:8080/internal",
        p256dh="p",
        auth="a",
    )
    db_session.add_all([bad, good])
    await db_session.commit()

    delivered: list[str] = []

    async def fake_webpush(**kwargs):
        delivered.append(kwargs["subscription_info"]["endpoint"])
        return None

    monkeypatch.setattr("app.notifications.push.webpush_async", fake_webpush)

    ok, detail = await deliver_push(
        db_session,
        [bad, good],
        {"title": "hi"},
        private_key="k",
        subject="mailto:a@b.com",
    )

    assert ok is True
    assert delivered == ["https://fcm.googleapis.com/fcm/send/good"]
    assert "1/2 delivered" in detail
    assert "invalid endpoint" in detail
