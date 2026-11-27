"""HOMST's Smart Event Assistant: turn messages or screenshots into event drafts."""

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app import ai
from app.db import get_db
from app.models.all import AiConversation, Calendar, Event, Household, Member
from app.schemas.all import (
    AiConfigUpdate,
    AiConversationResponse,
    AiConversationWrite,
    AiImageRequest,
    AiImageResponse,
    AiModelsResponse,
    AiParseRequest,
    AiParseResponse,
    AiStatusResponse,
    AiTestResponse,
)

router = APIRouter()

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"

# Chat attachments are kept on the same persistent uploads volume as photos,
# under a UUID filename, and referenced from the saved conversation by URL.
# Keeping the bytes out of the transcript row matters: that JSON is rewritten
# in full on every turn. One directory per feature (chats, photos, ...) leaves
# room for other upload kinds to land beside them later.
CHAT_IMAGE_DIR = "uploads/chats"
os.makedirs(CHAT_IMAGE_DIR, exist_ok=True)


def _http_error(exc: ai.AiError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


async def _load_busy(
    db: AsyncSession,
    members: list[tuple[str, str]],
    exclude_event_id: str | None = None,
) -> list[dict]:
    """Household events the assistant may inspect or change, with refs.

    Each row gets a per-request ``ref`` used by the model's updates/deletes so
    an event id never appears in the prompt. The window is deliberately wide
    (±5 years); the cap keeps the prompt bounded on very large calendars.
    """
    cal_ids = (
        await db.execute(
            select(Calendar.id).where(
                Calendar.household_id == DEFAULT_HOUSEHOLD_ID
            )
        )
    ).scalars().all()
    if not cal_ids:
        return []
    now = datetime.now(timezone.utc)
    from_dt = now - timedelta(days=1825)
    to_dt = now + timedelta(days=1825)
    rows = (
        await db.execute(
            select(Event)
            .where(
                Event.calendar_id.in_(cal_ids),
                or_(
                    func.coalesce(Event.end_at, Event.start_at) >= from_dt,
                    Event.recurrence["freq"].as_string().isnot(None),
                ),
                Event.start_at <= to_dt,
                Event.id != exclude_event_id if exclude_event_id else True,
            )
            .order_by(Event.start_at)
            .limit(ai.MAX_BUSY_EVENTS)
        )
    ).scalars().all()
    names = {member_id: name for member_id, name in members}
    busy: list[dict] = []
    for event in rows:
        if event.start_at is None:
            continue
        busy.append(
            {
                "ref": len(busy) + 1,
                "id": getattr(event, "id", None),
                "title": event.title,
                "description": getattr(event, "description", "") or "",
                "start_at": event.start_at.isoformat(),
                "end_at": event.end_at.isoformat() if event.end_at else None,
                "all_day": bool(event.all_day),
                "assignee_id": event.assignee_id,
                "assignee": names.get(event.assignee_id),
                "recurrence": event.recurrence,
                "reminder_minutes": getattr(event, "reminder_minutes", None),
                "external": getattr(event, "source", "internal") == "external",
            }
        )
    return busy


def _local_iso(value: datetime | None, tz) -> str | None:
    if value is None:
        return None
    moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return moment.astimezone(tz).isoformat()


async def _load_focus_event(
    req: AiParseRequest, db: AsyncSession, members: list[tuple[str, str]], tz
) -> dict | None:
    """The existing event a resumed conversation is editing, if any."""
    if req.focus_event_id is None:
        return None
    result = await db.execute(
        select(Event)
        .join(Calendar)
        .where(
            Event.id == str(req.focus_event_id),
            Calendar.household_id == DEFAULT_HOUSEHOLD_ID,
        )
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    names = {member_id: name for member_id, name in members}
    return {
        "title": event.title,
        "description": event.description or "",
        "start_at": _local_iso(event.start_at, tz),
        "end_at": _local_iso(event.end_at, tz),
        "all_day": bool(event.all_day),
        "recurrence": event.recurrence,
        "reminder_minutes": event.reminder_minutes,
        "assignee": names.get(event.assignee_id),
    }


async def _load_context(req: AiParseRequest, db: AsyncSession):
    """Resolve the timezone, members, nearby events and edit target."""
    household = await db.get(Household, DEFAULT_HOUSEHOLD_ID)
    household_settings = household.settings if household and household.settings else {}
    timezone_name = req.timezone or household_settings.get("timezone")
    tz, tz_label = ai.resolve_timezone(
        timezone_name if isinstance(timezone_name, str) else None
    )
    rows = await db.execute(
        select(Member.id, Member.name).where(Member.household_id == DEFAULT_HOUSEHOLD_ID)
    )
    members = [(row[0], row[1]) for row in rows.all()]
    busy = await _load_busy(
        db,
        members,
        exclude_event_id=str(req.focus_event_id) if req.focus_event_id else None,
    )
    focus_event = await _load_focus_event(req, db, members, tz)
    return tz, tz_label, members, busy, focus_event


async def _require_config(db: AsyncSession) -> dict:
    config = await ai.load_config(db)
    if config is None:
        raise HTTPException(status_code=503, detail="Smart import needs an OpenCode API key")
    return config


@router.post("/images", response_model=AiImageResponse, status_code=201)
async def store_chat_image(req: AiImageRequest):
    """Keep a screenshot so a saved conversation can show it again.

    The picture is re-encoded exactly like the copy sent to the model, so EXIF
    and GPS metadata never reach the disk. Only the label keeps the original
    filename; the file on disk is named after a fresh UUID.
    """
    try:
        data = ai.normalized_image_bytes(req.image)
    except ai.AiImageError as exc:
        raise _http_error(exc) from exc
    filename = f"{uuid.uuid4()}.png"
    with open(os.path.join(CHAT_IMAGE_DIR, filename), "wb") as handle:
        handle.write(data)
    label = " ".join(req.name.split())[:255] or "Image"
    return {"name": label, "url": f"/uploads/chats/{filename}"}


@router.get("", response_model=AiStatusResponse)
async def get_ai_status(db: AsyncSession = Depends(get_db)):
    """Whether Smart import is configured. Never returns the key."""
    return ai.status_payload(await ai.load_config(db))


@router.put("", response_model=AiStatusResponse)
async def update_ai_config(
    req: AiConfigUpdate, db: AsyncSession = Depends(get_db)
):
    key = req.api_key.get_secret_value() if req.api_key is not None else None
    try:
        config = await ai.save_config(db, key, req.provider, req.model)
    except ai.AiError as exc:
        raise _http_error(exc) from exc
    return ai.status_payload(config)


@router.delete("", status_code=204)
async def delete_ai_config(db: AsyncSession = Depends(get_db)):
    await ai.clear_config(db)


@router.get("/models", response_model=AiModelsResponse)
async def list_ai_models(
    provider: Literal["console", "go"] | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Refresh the provider's model catalog. Requires a saved key.

    ``provider`` lets Settings preview a plan the household has selected but
    not saved yet. It can only be one of the two fixed gateways.
    """
    config = await ai.load_config(db)
    if config is None:
        raise HTTPException(status_code=503, detail="Smart import needs an OpenCode API key")
    if provider is not None:
        config = {**config, "provider": provider}
    try:
        return await ai.list_models(config)
    except ai.AiError as exc:
        raise _http_error(exc) from exc


@router.post("/test", response_model=AiTestResponse)
async def test_ai_connection(db: AsyncSession = Depends(get_db)):
    config = await ai.load_config(db)
    if config is None:
        raise HTTPException(status_code=503, detail="Smart import needs an OpenCode API key")
    try:
        ok, message = await ai.test_connection(config)
    except ai.AiError as exc:
        raise _http_error(exc) from exc
    return {**ai.status_payload(config), "ok": ok, "message": message}


def _conversation_title(req: AiConversationWrite) -> str:
    title = req.title.strip()
    if not title:
        for turn in req.turns:
            if turn.role == "user" and turn.text.strip():
                title = turn.text
                break
    return " ".join(title.split())[:255] or "Smart import"


def _conversation_response(row: AiConversation) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "turns": row.turns or [],
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


@router.post("/conversations", response_model=AiConversationResponse, status_code=201)
async def create_conversation(
    req: AiConversationWrite, db: AsyncSession = Depends(get_db)
):
    """Save a Smart import chat so its events can reopen it later."""
    row = AiConversation(
        household_id=DEFAULT_HOUSEHOLD_ID,
        title=_conversation_title(req),
        turns=[turn.model_dump() for turn in req.turns[-40:]],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _conversation_response(row)


@router.get(
    "/conversations/{conversation_id}", response_model=AiConversationResponse
)
async def get_conversation(
    conversation_id: str, db: AsyncSession = Depends(get_db)
):
    row = await db.get(AiConversation, conversation_id)
    if row is None or row.household_id != DEFAULT_HOUSEHOLD_ID:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return _conversation_response(row)


@router.patch(
    "/conversations/{conversation_id}", response_model=AiConversationResponse
)
async def update_conversation(
    conversation_id: str,
    req: AiConversationWrite,
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(AiConversation, conversation_id)
    if row is None or row.household_id != DEFAULT_HOUSEHOLD_ID:
        raise HTTPException(status_code=404, detail="Conversation not found")
    row.title = _conversation_title(req)
    row.turns = [turn.model_dump() for turn in req.turns[-40:]]
    await db.commit()
    await db.refresh(row)
    return _conversation_response(row)


@router.post("/parse", response_model=AiParseResponse)
async def parse_schedule(
    req: AiParseRequest, db: AsyncSession = Depends(get_db)
):
    """Parse text/screenshot into drafts. Creating the events stays explicit."""
    config = await _require_config(db)
    tz, tz_label, members, busy, focus_event = await _load_context(req, db)
    try:
        return await ai.parse_schedule(
            config,
            text=req.text,
            image=req.image,
            tz=tz,
            tz_label=tz_label,
            members=members,
            busy=busy,
            clarifications=[item.model_dump() for item in req.clarifications],
            history=[item.model_dump() for item in req.history],
            focus_event=focus_event,
        )
    except ai.AiError as exc:
        raise _http_error(exc) from exc


@router.post("/parse/stream")
async def parse_schedule_stream(
    req: AiParseRequest, db: AsyncSession = Depends(get_db)
):
    """Same as ``/parse``, but relays reasoning/content deltas as SSE."""
    config = await _require_config(db)
    if not req.text.strip() and not req.image:
        raise HTTPException(status_code=422, detail="Paste an email or attach a screenshot")
    tz, tz_label, members, busy, focus_event = await _load_context(req, db)

    async def event_generator():
        try:
            async for event in ai.stream_schedule(
                config,
                text=req.text,
                image=req.image,
                tz=tz,
                tz_label=tz_label,
                members=members,
                busy=busy,
                clarifications=[item.model_dump() for item in req.clarifications],
                history=[item.model_dump() for item in req.history],
                focus_event=focus_event,
            ):
                yield {"event": event["type"], "data": json.dumps(event)}
        except ai.AiError as exc:
            yield {
                "event": "error",
                "data": json.dumps(
                    {"detail": str(exc), "status": exc.status_code}
                ),
            }

    return EventSourceResponse(
        event_generator(),
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
