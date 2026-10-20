"""System/version endpoints and the stable-release update API."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import updater_client
from app.config import settings
from app.db import get_db
from app.events.publisher import publish_event
from app.models.all import Household
from app.schemas.system import DismissRequest, InstallRequest
from app.system_state import (
    ACTIVE_JOB_STATES,
    OFFICIAL_IMAGE_REPO,
    ImageRef,
    is_major_update,
    is_managed,
    is_newer,
    is_stable_version,
    merge_update_prefs,
)
from app.updates import fetch_releases
from app.version import COMMIT, VERSION

router = APIRouter()

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"


def _host_only(value: str | None) -> str:
    """Return the host name of a Host header or Origin URL, ignoring the port."""

    if not value:
        return ""
    parsed = urlparse(value if "://" in value else f"//{value}")
    return (parsed.hostname or "").rstrip(".")


def _require_update_header(request: Request) -> None:
    """Reject simple cross-site form posts; the UI sends this header."""

    if request.headers.get("x-homst-update") != "1":
        raise HTTPException(
            status_code=403,
            detail="Missing X-HOMST-Update confirmation header.",
        )

    origin = request.headers.get("origin")
    if origin:
        # The bundled reverse proxy forwards Host without the public port
        # (for example :8443), while the browser always includes it in Origin.
        # Compare host names only; the custom header above already stops
        # cross-site form posts.
        forwarded_host = request.headers.get("x-forwarded-host", "").split(",")[0]
        origin_host = _host_only(origin)
        request_host = _host_only(
            forwarded_host.strip() or request.headers.get("host", "")
        )
        if origin_host and request_host and origin_host != request_host:
            raise HTTPException(status_code=403, detail="Cross-origin update blocked.")


async def _household(db: AsyncSession) -> Household | None:
    result = await db.execute(
        select(Household).where(Household.id == DEFAULT_HOUSEHOLD_ID)
    )
    return result.scalar_one_or_none()


async def _household_settings(db: AsyncSession) -> dict:
    household = await _household(db)
    return dict(household.settings or {}) if household else {}


def _channel(current: str, target: dict | None) -> str:
    ref = ImageRef.parse(target.get("image")) if target else ImageRef("", None, None)
    if ref.repo and ref.repo != OFFICIAL_IMAGE_REPO:
        return "custom"
    if ref.digest:
        return "pinned"
    if ref.tag and ref.tag.startswith("dev"):
        return "nightly"
    if not is_stable_version(current):
        return "nightly"
    if ref.tag and ref.tag not in ("latest",):
        labels = (target or {}).get("labels") or {}
        if str(labels.get("homst.managed", "")).lower() != "true":
            return "pinned"
    return "stable"


def _manual_commands(tag: str | None) -> dict[str, str]:
    compose = "docker compose -f docker-compose.prod.yml"
    tag = tag or ""
    prefix = f"HOMST_VERSION={tag} " if tag and tag != "latest" else ""
    stable_prefix = "HOMST_VERSION=latest "
    return {
        "current": f"{prefix}{compose} pull && {prefix}{compose} up -d",
        "stable": f"{stable_prefix}{compose} pull && {stable_prefix}{compose} up -d",
    }


async def _snapshot(db: AsyncSession, refresh: bool = False) -> dict:
    household_settings = await _household_settings(db)

    feed, target, status = await asyncio.gather(
        fetch_releases(force=refresh),
        updater_client.get_target(),
        updater_client.get_status(),
    )

    current = VERSION
    releases = list(feed.releases)
    latest = releases[0] if releases else None
    managed, reason = is_managed(
        target, current, settings.homst_self_update_disabled
    )
    updater_available = target is not None
    if not updater_available and not reason:
        reason = "The updater service is not running."

    ref = ImageRef.parse(target.get("image")) if target else ImageRef("", None, None)
    tag = ref.tag or ""
    channel = _channel(current, target)

    status = status or {}
    previous_version = status.get("previous_version")
    held_version = status.get("held_version")
    job = status.get("job")
    prefs = merge_update_prefs(household_settings.get("updates"))

    update_available = bool(
        managed
        and latest
        and is_stable_version(current)
        and is_newer(current, latest["version"])
    )

    latest_version = latest["version"] if latest else None
    dismissed_version = household_settings.get("updateDismissedVersion")
    job_active = bool(job and job.get("state") in ACTIVE_JOB_STATES)
    prompt_version = (
        latest_version
        if (
            prefs["enabled"]
            and update_available
            and not job_active
            and latest_version != held_version
            and latest_version != dismissed_version
        )
        else None
    )

    release_rows = []
    for release in releases[:10]:
        version = release["version"]
        release_rows.append(
            {
                **release,
                "current": version == current,
                "latest": bool(latest and version == latest["version"]),
                "previous": version == previous_version,
                "held": version == held_version,
                "major": is_major_update(current, version),
                "newer": is_newer(current, version),
            }
        )
    latest_row = release_rows[0] if release_rows else None

    return {
        "current": {
            "version": current,
            "commit": COMMIT,
            "image": target.get("image") if target else None,
            "tag": tag or None,
            "digest": ref.digest,
            "channel": channel,
        },
        "latest": latest_row,
        "update_available": update_available,
        "releases": release_rows,
        "previous": {
            "version": previous_version,
            "image": status.get("previous_image"),
        },
        "held": {
            "version": held_version,
            "reason": status.get("held_reason"),
        },
        "job": job,
        "auto": prefs,
        "update_prompt": {
            "version": prompt_version,
            "dismissed": bool(
                update_available
                and latest_version
                and dismissed_version == latest_version
            ),
        },
        "self_update": {
            "available": updater_available,
            "managed": managed,
            "reason": reason,
            "mode": "managed" if managed else "manual",
        },
        "manual": _manual_commands(tag),
        "checked_at": (
            datetime.fromtimestamp(feed.checked_at, tz=timezone.utc).isoformat()
            if feed.checked_at
            else None
        ),
        "stale": feed.stale,
        "error": feed.error,
    }


@router.get("/status")
async def system_status(
    refresh: bool = False,
    db: AsyncSession = Depends(get_db),
):
    return await _snapshot(db, refresh=refresh)


@router.get("/job")
async def update_job():
    status = await updater_client.get_status()
    if status is None:
        raise HTTPException(status_code=503, detail="Updater service is unavailable.")
    return status


@router.post("/install", status_code=202)
async def install_version(
    req: InstallRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _require_update_header(request)
    snapshot = await _snapshot(db)

    if not snapshot["self_update"]["available"]:
        raise HTTPException(
            status_code=503,
            detail=snapshot["self_update"]["reason"]
            or "The updater service is not running.",
        )
    if not snapshot["self_update"]["managed"]:
        raise HTTPException(
            status_code=409,
            detail=snapshot["self_update"]["reason"]
            or "This install is not managed by the updater.",
        )

    releases = snapshot["releases"]
    versions = {release["version"] for release in releases}
    if not releases:
        raise HTTPException(
            status_code=503,
            detail="Could not verify the official release list. Try again shortly.",
        )
    if req.version not in versions:
        raise HTTPException(
            status_code=400,
            detail=f"{req.version} is not an official stable release.",
        )
    if req.version == snapshot["current"]["version"]:
        raise HTTPException(
            status_code=409, detail=f"HOMST {req.version} is already running."
        )
    if snapshot["held"]["version"] == req.version and not req.retry:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{req.version} was held after a failed install. "
                "Retry explicitly if you want to try it again."
            ),
        )

    latest_version = (
        snapshot["latest"]["version"] if snapshot["latest"] else None
    )
    try:
        job = await updater_client.install(
            req.version, latest=req.version == latest_version
        )
    except updater_client.UpdaterError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    try:
        await publish_event(
            DEFAULT_HOUSEHOLD_ID,
            "system.update.starting",
            {"version": req.version, "job_id": job.get("id")},
        )
    except Exception:
        pass

    return JSONResponse(status_code=202, content=job)


@router.post("/prompt/dismiss")
async def dismiss_update_prompt(
    req: DismissRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Stop asking display clients about this release.

    The update stays visible in Settings → Software update, and a newer stable
    release will be offered again.
    """

    _require_update_header(request)
    household = await _household(db)
    if household is None:
        household = Household(id=DEFAULT_HOUSEHOLD_ID, name="Home", settings={})
        db.add(household)
        await db.flush()

    settings = dict(household.settings or {})
    settings["updateDismissedVersion"] = req.version
    household.settings = settings
    await db.commit()

    try:
        await publish_event(
            DEFAULT_HOUSEHOLD_ID,
            "system.update.dismissed",
            {"version": req.version},
        )
    except Exception:
        pass

    return {"dismissed": req.version}


@router.post("/recovery/retry-rollback")
async def retry_rollback(request: Request):
    _require_update_header(request)
    try:
        return await updater_client.retry_rollback()
    except updater_client.UpdaterError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
