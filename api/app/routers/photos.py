import io
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.events.publisher import publish_event
from app.models.all import Household, Photo, new_uuid
from app.schemas.all import PhotoResponse, PhotoUpdate

router = APIRouter()
DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"
UPLOAD_DIR = "uploads/photos"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Scale uploaded photos down to ~720p: the longest edge is capped at this many
# pixels (720p = 1280x720), preserving the aspect ratio. Smaller images are
# stored untouched — we never upscale.
MAX_PHOTO_EDGE = 1280

# Image formats we re-encode and resize. Anything else (GIF animations,
# videos, plain text, ...) is stored verbatim.
_RESIZABLE_FORMATS = {"JPEG", "PNG", "WEBP"}


def _resize_image(data: bytes) -> bytes:
    """Downscale an image so its longest edge is at most MAX_PHOTO_EDGE.

    Applies EXIF orientation (so phone photos are not stored rotated) and
    re-encodes the result. Raises ``UnidentifiedImageError``/``OSError``/
    ``ValueError`` when the payload is not a resizable image — callers fall
    back to storing the raw bytes in that case.
    """
    with Image.open(io.BytesIO(data)) as img:
        fmt = img.format
        if fmt not in _RESIZABLE_FORMATS:
            raise ValueError(f"unsupported image format: {fmt}")
        img = ImageOps.exif_transpose(img) or img
        if img.width > MAX_PHOTO_EDGE or img.height > MAX_PHOTO_EDGE:
            scale = MAX_PHOTO_EDGE / max(img.width, img.height)
            new_size = (round(img.width * scale), round(img.height * scale))
            img = img.resize(new_size, Image.LANCZOS)
        if fmt == "JPEG" and img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        out = io.BytesIO()
        if fmt == "JPEG":
            img.save(out, format="JPEG", quality=85, optimize=True)
        elif fmt == "WEBP":
            img.save(out, format="WEBP", quality=80)
        else:
            img.save(out, format=fmt, optimize=True)
        return out.getvalue()


async def _get_or_create_household(db: AsyncSession) -> Household:
    result = await db.execute(select(Household).where(Household.id == DEFAULT_HOUSEHOLD_ID))
    hh = result.scalar_one_or_none()
    if hh:
        return hh
    hh = Household(id=DEFAULT_HOUSEHOLD_ID, name="Home", settings={})
    db.add(hh)
    await db.flush()
    return hh


def _photo_response(photo: Photo) -> PhotoResponse:
    return PhotoResponse(
        id=photo.id,
        url=f"/uploads/photos/{photo.filename}",
        selected=photo.selected,
        created_at=photo.created_at,
    )


async def _publish_photos_updated() -> None:
    """Tell every connected client the shared photo list changed."""
    try:
        await publish_event(DEFAULT_HOUSEHOLD_ID, "photos.updated", {})
    except Exception:
        pass


@router.post("/photos", response_model=PhotoResponse, status_code=201)
async def upload_photo(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    hh = await _get_or_create_household(db)
    ext = os.path.splitext(file.filename or ".jpg")[1] or ".jpg"
    filename = f"{uuid.uuid4()}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    data = await file.read()
    try:
        data = _resize_image(data)
    except (UnidentifiedImageError, OSError, ValueError):
        # Not an image (or unsupported format): store the original bytes.
        pass
    with open(path, "wb") as f:
        f.write(data)
    photo = Photo(id=new_uuid(), household_id=hh.id, filename=filename)
    db.add(photo)
    await db.commit()
    await db.refresh(photo)
    await _publish_photos_updated()
    return _photo_response(photo)


@router.get("/photos", response_model=list[PhotoResponse])
async def list_photos(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Photo).where(Photo.household_id == DEFAULT_HOUSEHOLD_ID).order_by(Photo.created_at)
    )
    photos = result.scalars().all()
    return [_photo_response(p) for p in photos]


@router.patch("/photos/{photo_id}", response_model=PhotoResponse)
async def update_photo(photo_id: str, update: PhotoUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Photo).where(Photo.id == photo_id, Photo.household_id == DEFAULT_HOUSEHOLD_ID)
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    photo.selected = update.selected
    await db.commit()
    await db.refresh(photo)
    await _publish_photos_updated()
    return _photo_response(photo)


@router.delete("/photos/{photo_id}", status_code=204)
async def delete_photo(photo_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Photo).where(Photo.id == photo_id, Photo.household_id == DEFAULT_HOUSEHOLD_ID)
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    path = os.path.join(UPLOAD_DIR, photo.filename)
    if os.path.exists(path):
        os.remove(path)
    await db.delete(photo)
    await db.commit()
    await _publish_photos_updated()
