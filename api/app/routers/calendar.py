from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.events.publisher import publish_event
from app.household import DEFAULT_HOUSEHOLD_ID, get_or_create_household
from app.models.all import AiConversation, Calendar, Event, ReminderLog
from app.schemas.all import (
    CalendarCreate,
    CalendarResponse,
    CalendarUpdate,
    EventCreate,
    EventResponse,
    EventUpdate,
    SubscribeCalendarRequest,
)

router = APIRouter()


async def household_calendars(db: AsyncSession) -> list[Calendar]:
    result = await db.execute(
        select(Calendar).where(Calendar.household_id == DEFAULT_HOUSEHOLD_ID)
    )
    return result.scalars().all()


@router.get("/calendars", response_model=list[CalendarResponse])
async def list_calendars(db: AsyncSession = Depends(get_db)):
    await get_or_create_household(db)
    return await household_calendars(db)


@router.post("/calendars", response_model=CalendarResponse, status_code=201)
async def create_calendar(req: CalendarCreate, db: AsyncSession = Depends(get_db)):
    await get_or_create_household(db)
    cal = Calendar(
        household_id=DEFAULT_HOUSEHOLD_ID,
        name=req.name,
        color=req.color,
        source=req.source,
        feed_url=req.feed_url,
        is_visible=True,
        created_by=None,
    )
    db.add(cal)
    await db.commit()
    return cal


@router.post("/calendars/subscribe", response_model=CalendarResponse, status_code=201)
async def subscribe_calendar(req: SubscribeCalendarRequest, db: AsyncSession = Depends(get_db)):
    await get_or_create_household(db)
    cal = Calendar(
        household_id=DEFAULT_HOUSEHOLD_ID,
        name=req.name or "Subscribed Calendar",
        color=req.color,
        source="ical",
        feed_url=req.feed_url,
        is_visible=True,
        created_by=None,
    )
    db.add(cal)
    await db.commit()
    return cal


@router.patch("/calendars/{calendar_id}", response_model=CalendarResponse)
async def update_calendar(
    calendar_id: UUID, req: CalendarUpdate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Calendar).where(
            Calendar.id == str(calendar_id),
            Calendar.household_id == DEFAULT_HOUSEHOLD_ID,
        )
    )
    cal = result.scalar_one_or_none()
    if not cal:
        raise HTTPException(status_code=404, detail="Calendar not found")
    if req.name is not None:
        cal.name = req.name
    if req.color is not None:
        cal.color = req.color
    if req.is_visible is not None:
        cal.is_visible = req.is_visible
    await db.commit()
    return cal


@router.delete("/calendars/{calendar_id}")
async def delete_calendar(calendar_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Calendar).where(
            Calendar.id == str(calendar_id),
            Calendar.household_id == DEFAULT_HOUSEHOLD_ID,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Calendar not found")
    await db.execute(
        delete(ReminderLog).where(
            ReminderLog.event_id.in_(
                select(Event.id).where(Event.calendar_id == str(calendar_id))
            )
        )
    )
    await db.execute(delete(Event).where(Event.calendar_id == str(calendar_id)))
    await db.execute(delete(Calendar).where(Calendar.id == str(calendar_id)))
    await db.commit()
    return {"message": "Calendar deleted"}


def _event_to_response(ev: Event) -> EventResponse:
    return EventResponse(
        id=UUID(ev.id),
        calendar_id=UUID(ev.calendar_id),
        title=ev.title,
        description=ev.description or "",
        source_message=ev.source_message,
        ai_conversation_id=(
            UUID(ev.ai_conversation_id) if ev.ai_conversation_id else None
        ),
        start_at=ev.start_at,
        end_at=ev.end_at,
        all_day=ev.all_day or False,
        recurrence=ev.recurrence,
        reminder_minutes=ev.reminder_minutes,
        source=ev.source or "internal",
        external_uid=ev.external_uid,
        assignee_id=UUID(ev.assignee_id) if ev.assignee_id else None,
        created_by=UUID(ev.created_by) if ev.created_by else None,
        created_at=ev.created_at,
        updated_at=ev.updated_at,
    )


async def household_events(
    db: AsyncSession,
    from_date: str | None = None,
    to_date: str | None = None,
    calendar_ids: str | None = None,
) -> list[Event]:
    query = (
        select(Event)
        .join(Calendar, Event.calendar_id == Calendar.id)
        .where(Calendar.household_id == DEFAULT_HOUSEHOLD_ID)
    )
    if calendar_ids:
        ids = [cid.strip() for cid in calendar_ids.split(",") if cid.strip()]
        if ids:
            query = query.where(Event.calendar_id.in_(ids))
    if from_date:
        dt_from = datetime.fromisoformat(from_date.replace("Z", "+00:00"))
        query = query.where(
            or_(
                func.coalesce(Event.end_at, Event.start_at) >= dt_from,
                Event.recurrence["freq"].as_string().isnot(None),
            )
        )
    if to_date:
        dt_to = datetime.fromisoformat(to_date.replace("Z", "+00:00"))
        query = query.where(Event.start_at <= dt_to)
    query = query.order_by(Event.start_at)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/events", response_model=list[EventResponse])
async def list_events(
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    calendar_ids: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await household_events(db, from_date, to_date, calendar_ids)


@router.post("/events", response_model=EventResponse, status_code=201)
async def create_event(req: EventCreate, db: AsyncSession = Depends(get_db)):
    cal_result = await db.execute(
        select(Calendar).where(
            Calendar.id == str(req.calendar_id),
            Calendar.household_id == DEFAULT_HOUSEHOLD_ID,
        )
    )
    cal = cal_result.scalar_one_or_none()

    if not cal:
        raise HTTPException(status_code=404, detail="Calendar not found")
    if req.end_at and req.end_at <= req.start_at:
        raise HTTPException(status_code=422, detail="end_at must be after start_at")

    conversation_id = None
    if req.ai_conversation_id is not None:
        conversation = await db.get(AiConversation, str(req.ai_conversation_id))
        if (
            conversation is None
            or conversation.household_id != DEFAULT_HOUSEHOLD_ID
        ):
            raise HTTPException(status_code=404, detail="Conversation not found")
        conversation_id = conversation.id

    ev = Event(
        calendar_id=str(cal.id),
        title=req.title,
        description=req.description or "",
        source_message=req.source_message,
        ai_conversation_id=conversation_id,
        start_at=req.start_at,
        end_at=req.end_at,
        all_day=req.all_day,
        recurrence=(
            req.recurrence.model_dump(mode="json", exclude_none=True)
            if req.recurrence is not None
            else None
        ),
        reminder_minutes=req.reminder_minutes,
        assignee_id=str(req.assignee_id) if req.assignee_id else None,
        source="internal",
        created_by=None,
    )
    db.add(ev)
    await db.commit()

    response = _event_to_response(ev)
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "event.created", response.model_dump(mode="json"))
    except Exception:
        pass

    return response


@router.patch("/events/{event_id}", response_model=EventResponse)
async def update_event(event_id: UUID, req: EventUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Event).join(Calendar).where(
            Event.id == str(event_id),
            Calendar.household_id == DEFAULT_HOUSEHOLD_ID,
        )
    )
    ev = result.scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if req.end_at is not None and req.start_at is not None and req.end_at <= req.start_at:
        raise HTTPException(status_code=422, detail="end_at must be after start_at")

    if req.title is not None:
        ev.title = req.title
    if req.description is not None:
        ev.description = req.description
    if "source_message" in req.model_fields_set:
        ev.source_message = req.source_message
    if "ai_conversation_id" in req.model_fields_set:
        conversation_id = None
        if req.ai_conversation_id is not None:
            conversation = await db.get(
                AiConversation, str(req.ai_conversation_id)
            )
            if (
                conversation is None
                or conversation.household_id != DEFAULT_HOUSEHOLD_ID
            ):
                raise HTTPException(
                    status_code=404, detail="Conversation not found"
                )
            conversation_id = conversation.id
        ev.ai_conversation_id = conversation_id
    if req.start_at is not None:
        ev.start_at = req.start_at
    if "end_at" in req.model_fields_set:
        ev.end_at = req.end_at
    if req.all_day is not None:
        ev.all_day = req.all_day
    if "recurrence" in req.model_fields_set:
        ev.recurrence = (
            req.recurrence.model_dump(mode="json", exclude_none=True)
            if req.recurrence is not None
            else None
        )
    if "reminder_minutes" in req.model_fields_set:
        ev.reminder_minutes = req.reminder_minutes
    if "assignee_id" in req.model_fields_set:
        ev.assignee_id = str(req.assignee_id) if req.assignee_id is not None else None

    await db.commit()
    response = _event_to_response(ev)
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "event.updated", response.model_dump(mode="json"))
    except Exception:
        pass
    return response


@router.delete("/events/{event_id}")
async def delete_event(event_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Event).join(Calendar).where(
            Event.id == str(event_id),
            Calendar.household_id == DEFAULT_HOUSEHOLD_ID,
        )
    )
    ev = result.scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.execute(delete(ReminderLog).where(ReminderLog.event_id == str(event_id)))
    await db.execute(delete(Event).where(Event.id == str(event_id)))
    await db.commit()
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "event.deleted", {"id": str(event_id)})
    except Exception:
        pass
    return {"message": "Event deleted"}
