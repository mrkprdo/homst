"""Household announcements.

An announcement is a short broadcast that appears on every connected screen.
It is stored so late joiners and reconnecting clients can catch up, and it is
fanned out immediately over the household SSE stream. When requested, it also
goes out as a Web Push notification so phones that have HOMST closed still see
it.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.events.publisher import publish_event
from app.models.all import Announcement, Member
from app.schemas.all import AnnouncementCreate, AnnouncementResponse

router = APIRouter()

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _is_active(announcement: Announcement, now: datetime) -> bool:
    if announcement.expires_at is None:
        return True
    return _as_utc(announcement.expires_at) > now


def _to_response(announcement: Announcement, author_name: str | None) -> AnnouncementResponse:
    return AnnouncementResponse(
        id=UUID(announcement.id),
        household_id=UUID(announcement.household_id),
        message=announcement.message,
        created_by=UUID(announcement.created_by) if announcement.created_by else None,
        author_name=author_name,
        created_at=announcement.created_at,
        expires_at=announcement.expires_at,
    )


async def _author_names(db: AsyncSession, announcements: list[Announcement]) -> dict[str, str]:
    ids = {a.created_by for a in announcements if a.created_by}
    if not ids:
        return {}
    result = await db.execute(select(Member).where(Member.id.in_(ids)))
    return {member.id: member.name for member in result.scalars().all()}


@router.get("/announcements", response_model=list[AnnouncementResponse])
async def list_announcements(db: AsyncSession = Depends(get_db)):
    """Active announcements, newest first.

    Expiry is evaluated in Python so the endpoint behaves the same on SQLite
    (tests) and PostgreSQL (production), where datetime storage differs.
    """
    result = await db.execute(
        select(Announcement)
        .where(Announcement.household_id == DEFAULT_HOUSEHOLD_ID)
        .order_by(Announcement.created_at.desc())
        .limit(50)
    )
    now = _utcnow()
    active = [a for a in result.scalars().all() if _is_active(a, now)]
    names = await _author_names(db, active)
    return [_to_response(a, names.get(a.created_by or "")) for a in active]


@router.post("/announcements", response_model=AnnouncementResponse, status_code=201)
async def create_announcement(req: AnnouncementCreate, db: AsyncSession = Depends(get_db)):
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Announcement message cannot be empty")

    author: Member | None = None
    if req.created_by:
        author = await db.get(Member, str(req.created_by))
        if author is None or author.household_id != DEFAULT_HOUSEHOLD_ID:
            raise HTTPException(status_code=404, detail="Member not found")

    now = _utcnow()
    expires_at = (
        now + timedelta(minutes=req.duration_minutes) if req.duration_minutes is not None else None
    )
    announcement = Announcement(
        household_id=DEFAULT_HOUSEHOLD_ID,
        message=message,
        created_by=author.id if author else None,
        created_at=now,
        expires_at=expires_at,
    )
    db.add(announcement)
    await db.commit()
    await db.refresh(announcement)

    response = _to_response(announcement, author.name if author else None)

    try:
        await publish_event(
            DEFAULT_HOUSEHOLD_ID,
            "announcement.created",
            response.model_dump(mode="json"),
        )
    except Exception:
        pass

    if req.send_push:
        await _send_push(db, response)

    return response


async def _send_push(db: AsyncSession, announcement: AnnouncementResponse) -> None:
    """Best-effort Web Push fan-out; a push failure must not fail the post."""
    try:
        from app.notifications.push import (
            deliver_push,
            get_vapid_keys,
            push_payload,
            subscriptions_for,
            vapid_subject,
        )

        subscriptions = await subscriptions_for(db, DEFAULT_HOUSEHOLD_ID)
        if not subscriptions:
            return
        _, private_key = await get_vapid_keys(db)
        title = (
            f"Announcement from {announcement.author_name}"
            if announcement.author_name
            else "Household announcement"
        )
        await deliver_push(
            db,
            subscriptions,
            push_payload(
                title,
                announcement.message,
                url=f"/?announcement={announcement.id}",
                tag=f"announcement:{announcement.id}",
            ),
            private_key=private_key,
            subject=vapid_subject(),
        )
    except Exception:
        pass


@router.delete("/announcements/{announcement_id}")
async def delete_announcement(
    announcement_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Announcement).where(
            Announcement.id == str(announcement_id),
            Announcement.household_id == DEFAULT_HOUSEHOLD_ID,
        )
    )
    announcement = result.scalar_one_or_none()
    if announcement is None:
        raise HTTPException(status_code=404, detail="Announcement not found")

    await db.delete(announcement)
    await db.commit()
    try:
        await publish_event(
            DEFAULT_HOUSEHOLD_ID,
            "announcement.deleted",
            {"id": str(announcement_id)},
        )
    except Exception:
        pass
    return {"message": "Announcement removed"}
