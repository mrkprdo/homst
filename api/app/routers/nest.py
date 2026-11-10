"""Nest thermostat and temperature-sensor endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.nest import (
    NestAuthError,
    clear_credentials,
    get_temperatures,
    save_credentials,
)
from app.schemas.all import NestCredentials

router = APIRouter()


@router.get("/temperatures")
async def temperatures(
    refresh: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """Current readings for the thermostat and every Nest Temperature Sensor."""
    return await get_temperatures(db, force=refresh)


@router.post("/credentials")
async def set_credentials(
    req: NestCredentials,
    db: AsyncSession = Depends(get_db),
):
    """Save (and immediately test) the Nest credentials."""
    try:
        await save_credentials(
            db,
            account_type=req.account_type,
            issue_token=req.issue_token,
            cookies=req.cookies,
            access_token=req.access_token,
        )
    except NestAuthError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await get_temperatures(db, force=True)


@router.delete("/credentials")
async def remove_credentials(db: AsyncSession = Depends(get_db)):
    """Forget the saved credentials and the cached readings."""
    await clear_credentials(db)
    return {"message": "Nest disconnected"}
