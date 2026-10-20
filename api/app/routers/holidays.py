from datetime import date

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.all import Holiday, Household
from app.schemas.all import HolidayResponse, HolidaySyncRequest

router = APIRouter()

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"
NAGER_BASE = "https://date.nager.at/api/v3"


async def _get_or_create_household(db: AsyncSession) -> Household:
    result = await db.execute(select(Household).where(Household.id == DEFAULT_HOUSEHOLD_ID))
    hh = result.scalar_one_or_none()
    if hh:
        return hh
    hh = Household(id=DEFAULT_HOUSEHOLD_ID, name="Home", settings={})
    db.add(hh)
    await db.flush()
    return hh


async def _fetch_nager_holidays(year: int, country_code: str) -> list[dict]:
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{NAGER_BASE}/PublicHolidays/{year}/{country_code}", timeout=10
            )
            if r.is_error:
                raise HTTPException(
                    status_code=502, detail=f"Nager.Date API error: {r.status_code}"
                )
            return r.json()
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Nager.Date API unavailable: {e}")


@router.post("/holidays/sync", status_code=201)
async def sync_holidays(
    req: HolidaySyncRequest,
    db: AsyncSession = Depends(get_db),
):
    hh = await _get_or_create_household(db)
    current_year = date.today().year
    years = [current_year, current_year + 1]

    all_holidays: list[dict] = []
    for year in years:
        data = await _fetch_nager_holidays(year, req.country_code)
        for h in data:
            if req.province:
                counties = h.get("counties") or []
                if counties and not any(
                    req.province.lower() in (c or "").lower() for c in counties
                ):
                    continue
            all_holidays.append({
                "date": h["date"],
                "name": h.get("localName") or h["name"],
                "local_name": h.get("localName"),
                "country_code": req.country_code,
                "province": req.province,
            })

    await db.execute(delete(Holiday).where(Holiday.household_id == hh.id))
    for h_data in all_holidays:
        h = Holiday(
            household_id=hh.id,
            date=date.fromisoformat(h_data["date"]),
            name=h_data["name"],
            local_name=h_data["local_name"],
            country_code=h_data["country_code"],
            province=h_data["province"],
        )
        db.add(h)
    await db.commit()

    return {"message": f"Synced {len(all_holidays)} holidays"}


@router.get("/holidays", response_model=list[HolidayResponse])
async def list_holidays(
    db: AsyncSession = Depends(get_db),
):
    hh = await _get_or_create_household(db)
    result = await db.execute(
        select(Holiday).where(Holiday.household_id == hh.id).order_by(Holiday.date)
    )
    return result.scalars().all()
