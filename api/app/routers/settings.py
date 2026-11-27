import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auto_theme import auto_theme_state
from app.camera import (
    CameraError,
    merge_camera_settings,
    public_camera_settings,
    release_camera_stream,
)
from app.db import get_db
from app.events.publisher import publish_event
from app.models.all import Household
from app.schemas.all import HouseholdSettingsUpdate

router = APIRouter()

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"

GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"


async def _get_or_create_household(db: AsyncSession) -> Household:
    result = await db.execute(select(Household).where(Household.id == DEFAULT_HOUSEHOLD_ID))
    hh = result.scalar_one_or_none()
    if hh:
        return hh
    hh = Household(id=DEFAULT_HOUSEHOLD_ID, name="Home", settings={})
    db.add(hh)
    await db.flush()
    return hh


def _country_code(country: str | None) -> str | None:
    """Settings store a 2-letter ISO country code (e.g. 'CA'); normalize it."""
    if not country:
        return None
    code = country.strip().upper()
    return code if len(code) == 2 and code.isalpha() else None


async def _geocode_address(address: str | None, province: str | None, country: str | None) -> dict:
    code = _country_code(country)

    candidates: list[str] = []
    full = ", ".join(filter(None, [address, province]))
    if full:
        candidates.append(full)
    if address:
        candidates.append(address)
        city = address.rsplit(",", 1)[-1].strip()
        if city and city not in candidates:
            candidates.append(city)
    if province and province not in candidates:
        candidates.append(province)

    try:
        async with httpx.AsyncClient() as client:
            for q in candidates:
                params: dict = {"name": q, "count": "10", "language": "en", "format": "json"}
                if code:
                    params["countryCode"] = code
                resp = await client.get(GEOCODING_URL, params=params, timeout=10)
                if not resp.is_success:
                    continue
                data = resp.json()
                results = data.get("results") or []
                for r in results:
                    if code and (r.get("country_code") or "").upper() != code:
                        continue
                    return {"lat": r["latitude"], "lon": r["longitude"]}
    except Exception:
        pass
    return {}


@router.patch("/settings")
async def update_settings(
    req: HouseholdSettingsUpdate,
    db: AsyncSession = Depends(get_db),
):
    hh = await _get_or_create_household(db)
    if req.name is not None:
        hh.name = req.name
    merged = {**(hh.settings or {})}
    if req.settings is not None:
        previous_camera = merged.get("camera")
        merged.update(req.settings)

        if "camera" in req.settings:
            try:
                camera = merge_camera_settings(req.settings["camera"], previous_camera)
            except CameraError as exc:
                raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
            if camera is None:
                merged.pop("camera", None)
            else:
                merged["camera"] = camera

        address_changed = any(
            key in req.settings
            for key in ("address", "holidayProvince", "holidayCountry")
        )
        if address_changed and "lat" not in req.settings and "lon" not in req.settings:
            coords = await _geocode_address(
                merged.get("address"),
                merged.get("holidayProvince"),
                merged.get("holidayCountry"),
            )
            merged.update(coords)

    merged.pop("autoSunrise", None)
    merged.pop("autoSunset", None)

    auto_state = auto_theme_state(merged)
    if auto_state:
        merged["autoThemeDark"] = auto_state["autoThemeDark"]
    else:
        merged.pop("autoThemeDark", None)

    hh.settings = merged
    await db.commit()

    if req.settings is not None and "camera" in req.settings:
        await release_camera_stream(force=True)

    payload = _public_settings({**merged, **auto_state})
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "settings.updated", {"settings": payload})
    except Exception:
        pass
    return {"message": "Settings updated", "settings": payload}


def _public_settings(settings: dict) -> dict:
    """Copy settings with the camera password replaced by a presence flag."""
    out = dict(settings)
    out["camera"] = public_camera_settings(out.get("camera"))
    return out


@router.get("/settings")
async def get_settings(db: AsyncSession = Depends(get_db)):
    hh = await _get_or_create_household(db)
    settings = dict(hh.settings or {})
    settings.update(auto_theme_state(settings))
    return _public_settings(settings)
