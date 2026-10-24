"""Web Push (VAPID) delivery.

Reminders reach phones and browsers even when the app is closed by fanning a
payload out to every :class:`PushSubscription` the household has registered.
The service worker (``web/public/push-sw.js``) turns each payload into a
notification.

VAPID keys come from the environment when set; otherwise a pair is generated
on first use and persisted in ``server_settings`` so it survives restarts.
"""
from __future__ import annotations

import base64
import json
import logging
from datetime import datetime
from urllib.parse import urlsplit

from pywebpush import WebPushException, webpush_async
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.all import PushSubscription, ServerSetting

logger = logging.getLogger(__name__)

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"

# Endpoints answered with these statuses are gone for good — drop them.
GONE_STATUSES = {404, 410}

MAX_ENDPOINT_LENGTH = 2048

# Only real push services may receive a payload. Without this an attacker could
# register an internal URL and turn the reminders worker into an SSRF probe.
PUSH_HOST_ALLOWLIST = (
    "fcm.googleapis.com",
    "android.googleapis.com",
    "notify.windows.com",
    "push.apple.com",
    "push.services.mozilla.com",
    "push.samsungosp.com",
)


def validate_push_endpoint(endpoint: str) -> None:
    """Raise ``ValueError`` unless ``endpoint`` is a safe push-service URL.

    Guards against SSRF and internal port scanning: the endpoint must be HTTPS
    on the default port, without userinfo, and belong to a known push service.
    """
    if len(endpoint) > MAX_ENDPOINT_LENGTH:
        raise ValueError("push endpoint is too long")

    parsed = urlsplit(endpoint)
    if parsed.scheme != "https":
        raise ValueError("push endpoint must use https")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("push endpoint must not contain user information")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("push endpoint has an invalid port") from exc
    if port not in (None, 443):
        raise ValueError("push endpoint must use port 443")

    host = parsed.hostname
    if not host:
        raise ValueError("push endpoint is missing a hostname")

    host = host.lower()
    if not any(
        host == suffix or host.endswith("." + suffix)
        for suffix in PUSH_HOST_ALLOWLIST
    ):
        raise ValueError("push endpoint host is not a known push service")


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def generate_vapid_keys() -> tuple[str, str]:
    """Return ``(public_key, private_key)`` as base64url strings.

    The public key is the uncompressed EC point the browser wants as
    ``applicationServerKey``; the private key is the raw 32-byte scalar that
    pywebpush accepts as ``vapid_private_key``.
    """
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    private_raw = private_key.private_numbers().private_value.to_bytes(32, "big")
    numbers = private_key.public_key().public_numbers()
    public_raw = b"\x04" + numbers.x.to_bytes(32, "big") + numbers.y.to_bytes(32, "big")
    return _b64url(public_raw), _b64url(private_raw)


async def get_vapid_keys(session: AsyncSession) -> tuple[str, str]:
    """Return the server's VAPID key pair, generating and persisting it once."""
    if settings.vapid_public_key and settings.vapid_private_key:
        return settings.vapid_public_key, settings.vapid_private_key

    row = await session.get(ServerSetting, "vapid")
    if row:
        try:
            data = json.loads(row.value)
        except ValueError:
            data = {}
        if data.get("public") and data.get("private"):
            return data["public"], data["private"]

    public, private = generate_vapid_keys()
    payload = json.dumps({"public": public, "private": private})
    if row is None:
        session.add(ServerSetting(key="vapid", value=payload))
    else:
        row.value = payload
    try:
        await session.commit()
    except IntegrityError:
        # Another process generated a pair first — use theirs.
        await session.rollback()
        row = await session.get(ServerSetting, "vapid")
        data = json.loads(row.value) if row else {}
        if data.get("public") and data.get("private"):
            return data["public"], data["private"]
    return public, private


def vapid_subject() -> str:
    return settings.vapid_subject or "mailto:homst@localhost"


async def subscriptions_for(
    session: AsyncSession, household_id: str = DEFAULT_HOUSEHOLD_ID
) -> list[PushSubscription]:
    return list((await session.execute(
        select(PushSubscription).where(PushSubscription.household_id == household_id)
    )).scalars().all())


def _subscription_info(sub: PushSubscription) -> dict:
    return {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}


async def deliver_push(
    session: AsyncSession,
    subscriptions: list[PushSubscription],
    payload: dict,
    *,
    private_key: str,
    subject: str,
) -> tuple[bool, str]:
    """Send ``payload`` to every subscription; prune those the service rejects.

    Best-effort: a failing device never aborts the others, and a misconfigured
    push service never crashes the reminders worker.
    """
    if not subscriptions:
        return False, "no push subscriptions"

    data = json.dumps(payload)
    sent = 0
    pruned = 0
    errors: list[str] = []

    for sub in subscriptions:
        try:
            validate_push_endpoint(sub.endpoint)
        except ValueError:
            errors.append("invalid endpoint")
            continue
        try:
            await webpush_async(
                subscription_info=_subscription_info(sub),
                data=data,
                vapid_private_key=private_key,
                vapid_claims={"sub": subject},
                ttl=3600,
            )
            sent += 1
        except WebPushException as exc:
            status = exc.status_code
            if status in GONE_STATUSES:
                await session.delete(sub)
                pruned += 1
            else:
                errors.append(f"{status or 'error'}")
        except Exception as exc:  # aiohttp / crypto / encoding surprises
            errors.append(type(exc).__name__)

    if pruned:
        await session.commit()

    detail = f"{sent}/{len(subscriptions)} delivered"
    if pruned:
        detail += f", pruned {pruned}"
    if errors:
        detail += f", failed: {', '.join(errors)}"
    return sent > 0, detail


def push_payload(
    title: str,
    body: str,
    *,
    event_id: str | None = None,
    start_at: datetime | str | None = None,
    minutes_before: int | None = None,
    all_day: bool = False,
    url: str = "/",
    tag: str | None = None,
) -> dict:
    """Shape a payload the service worker can render as a notification."""
    if isinstance(start_at, datetime):
        start_at = start_at.isoformat()
    if tag is None and event_id:
        tag = f"{event_id}::{start_at}"
    return {
        "title": title,
        "body": body,
        "event_id": event_id,
        "start_at": start_at,
        "minutes_before": minutes_before,
        "all_day": all_day,
        "url": url,
        "tag": tag,
    }
