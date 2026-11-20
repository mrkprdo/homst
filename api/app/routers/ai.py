"""Smart import: turn pasted emails or screenshots into event drafts."""

import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app import ai
from app.db import get_db
from app.models.all import Household, Member
from app.schemas.all import (
    AiConfigUpdate,
    AiModelsResponse,
    AiParseRequest,
    AiParseResponse,
    AiStatusResponse,
    AiTestResponse,
)

router = APIRouter()

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"


def _http_error(exc: ai.AiError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


async def _load_context(req: AiParseRequest, db: AsyncSession):
    """Resolve the household timezone and member names for one import."""
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
    return tz, tz_label, members


async def _require_config(db: AsyncSession) -> dict:
    config = await ai.load_config(db)
    if config is None:
        raise HTTPException(status_code=503, detail="Smart import needs an OpenCode API key")
    return config


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


@router.post("/parse", response_model=AiParseResponse)
async def parse_schedule(
    req: AiParseRequest, db: AsyncSession = Depends(get_db)
):
    """Parse text/screenshot into drafts. Creating the events stays explicit."""
    config = await _require_config(db)
    tz, tz_label, members = await _load_context(req, db)
    try:
        return await ai.parse_schedule(
            config,
            text=req.text,
            image=req.image,
            tz=tz,
            tz_label=tz_label,
            members=members,
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
    tz, tz_label, members = await _load_context(req, db)

    async def event_generator():
        try:
            async for event in ai.stream_schedule(
                config,
                text=req.text,
                image=req.image,
                tz=tz,
                tz_label=tz_label,
                members=members,
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
