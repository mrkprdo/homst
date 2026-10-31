"""HTTP endpoints that serve the camera HLS playlist and segments."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.camera import (
    PLAYLIST_NAME,
    SEGMENT_PATTERN,
    TOKEN_PATTERN,
    CameraError,
    build_stream_url,
    camera_stream,
    camera_token,
    output_dir,
)
from app.db import get_db
from app.models.all import Household

router = APIRouter()

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"


async def _camera_settings(db: AsyncSession) -> dict | None:
    hh = await db.get(Household, DEFAULT_HOUSEHOLD_ID)
    if hh is None:
        return None
    camera = (hh.settings or {}).get("camera")
    return camera if isinstance(camera, dict) else None


def _check_token(camera: dict | None, token: str) -> str | None:
    """Return the stream source when ``token`` matches the current settings."""
    try:
        source = build_stream_url(camera)
    except CameraError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    if not source or camera_token(source) != token:
        return None
    return source


@router.get("/hls/{token}/index.m3u8")
async def camera_playlist(token: str, db: AsyncSession = Depends(get_db)):
    if not TOKEN_PATTERN.fullmatch(token):
        raise HTTPException(404, "Camera stream not found.")
    camera = await _camera_settings(db)
    if _check_token(camera, token) is None:
        raise HTTPException(404, "Camera stream not found.")

    try:
        directory = await camera_stream.ensure(camera)
    except CameraError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc

    path = directory / PLAYLIST_NAME
    if not path.is_file():
        raise HTTPException(404, "Camera stream not found.")
    return FileResponse(
        path,
        media_type="application/vnd.apple.mpegurl",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/hls/{token}/{segment}")
async def camera_segment(
    token: str,
    segment: str,
    db: AsyncSession = Depends(get_db),
):
    if not TOKEN_PATTERN.fullmatch(token) or not SEGMENT_PATTERN.fullmatch(segment):
        raise HTTPException(404, "Camera segment not found.")
    camera = await _camera_settings(db)
    if _check_token(camera, token) is None:
        raise HTTPException(404, "Camera segment not found.")

    path = output_dir(token) / segment
    if not path.is_file():
        raise HTTPException(404, "Camera segment not found.")
    return FileResponse(
        path,
        media_type="video/mp2t",
        headers={"Cache-Control": "no-store"},
    )
