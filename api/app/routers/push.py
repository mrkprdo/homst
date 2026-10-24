"""Web Push subscription management.

The frontend fetches the VAPID public key, subscribes via the browser's
PushManager, then registers the resulting endpoint here so the reminders
worker can reach the device.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.all import PushSubscription, utcnow
from app.notifications.push import (
    DEFAULT_HOUSEHOLD_ID,
    MAX_ENDPOINT_LENGTH,
    get_vapid_keys,
    validate_push_endpoint,
)
from app.schemas.all import (
    PushSubscribeRequest,
    PushUnsubscribeRequest,
    VapidKeyResponse,
)

router = APIRouter()

MAX_SUBSCRIPTIONS = 100
MAX_P256DH_LENGTH = 512
MAX_AUTH_LENGTH = 512
MAX_USER_AGENT_LENGTH = 255


@router.get("/push/vapid-public-key", response_model=VapidKeyResponse)
async def vapid_public_key(db: AsyncSession = Depends(get_db)):
    """The key a browser needs to create a push subscription."""
    public, _ = await get_vapid_keys(db)
    return VapidKeyResponse(key=public)


@router.post("/push/subscribe", status_code=201)
async def subscribe(req: PushSubscribeRequest, db: AsyncSession = Depends(get_db)):
    """Register (or refresh) a device's push subscription."""
    if len(req.endpoint) > MAX_ENDPOINT_LENGTH:
        raise HTTPException(status_code=422, detail="Push endpoint is too long")
    if len(req.keys.p256dh) > MAX_P256DH_LENGTH:
        raise HTTPException(status_code=422, detail="Push p256dh key is too long")
    if len(req.keys.auth) > MAX_AUTH_LENGTH:
        raise HTTPException(status_code=422, detail="Push auth key is too long")
    if req.user_agent and len(req.user_agent) > MAX_USER_AGENT_LENGTH:
        raise HTTPException(status_code=422, detail="Push user agent is too long")

    try:
        validate_push_endpoint(req.endpoint)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    existing = (await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == req.endpoint)
    )).scalar_one_or_none()

    if existing:
        existing.p256dh = req.keys.p256dh
        existing.auth = req.keys.auth
        existing.last_seen_at = utcnow()
        if req.user_agent:
            existing.user_agent = req.user_agent
    else:
        count = (await db.execute(
            select(func.count())
            .select_from(PushSubscription)
            .where(PushSubscription.household_id == DEFAULT_HOUSEHOLD_ID)
        )).scalar_one()
        if count >= MAX_SUBSCRIPTIONS:
            raise HTTPException(
                status_code=429, detail="Too many push subscriptions"
            )
        db.add(PushSubscription(
            household_id=DEFAULT_HOUSEHOLD_ID,
            endpoint=req.endpoint,
            p256dh=req.keys.p256dh,
            auth=req.keys.auth,
            user_agent=req.user_agent,
        ))
    await db.commit()
    return {"message": "subscribed"}


@router.post("/push/unsubscribe")
async def unsubscribe(req: PushUnsubscribeRequest, db: AsyncSession = Depends(get_db)):
    """Drop a device's push subscription (best-effort — unknown endpoints are fine)."""
    existing = (await db.execute(
        select(PushSubscription).where(PushSubscription.endpoint == req.endpoint)
    )).scalar_one_or_none()
    if existing:
        await db.delete(existing)
        await db.commit()
    return {"message": "unsubscribed"}
