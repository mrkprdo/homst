import io
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, select
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

# Hard limits enforced by the application rather than the reverse proxy.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PHOTOS = 200
# 40 megapixels is far beyond any phone camera but keeps a single request from
# allocating gigabytes while decoding. Pillow's own bomb guard is the backstop.
MAX_PIXELS = 40_000_000

# The only formats we decode and re-encode, mapped to the extension we store.
# Everything else (GIF, SVG, HTML, text, HEIC, ...) is rejected.
_STORED_EXTENSIONS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}


class _UnsupportedImageError(ValueError):
    """The payload is not one of the supported raster image formats."""


class _ImageTooLargeError(ValueError):
    """The decoded pixel payload would be unreasonably large."""


def _normalize_image(data: bytes) -> tuple[bytes, str]:
    """Decode an uploaded image, re-encode it, and return ``(bytes, extension)``.

    Applies EXIF orientation, caps the longest edge at MAX_PHOTO_EDGE (never
    upscaling) and re-encodes the pixels so metadata and any non-image payload
    are stripped. Raises ``_UnsupportedImageError``/``UnidentifiedImageError``
    for non-images, and ``_ImageTooLargeError`` for decompression bombs.
    """
    try:
        with Image.open(io.BytesIO(data)) as img:
            fmt = img.format
            ext = _STORED_EXTENSIONS.get(fmt or "")
            if ext is None:
                raise _UnsupportedImageError(f"unsupported image format: {fmt}")
            width, height = img.size
            if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
                raise _ImageTooLargeError(f"image too large: {width}x{height}")
            img = ImageOps.exif_transpose(img) or img
            if img.width > MAX_PHOTO_EDGE or img.height > MAX_PHOTO_EDGE:
                scale = MAX_PHOTO_EDGE / max(img.width, img.height)
                new_size = (round(img.width * scale), round(img.height * scale))
                img = img.resize(new_size, Image.LANCZOS)
            out = io.BytesIO()
            if fmt == "JPEG":
                if img.mode not in ("RGB", "L"):
                    img = img.convert("RGB")
                img.save(out, format="JPEG", quality=85, optimize=True)
            elif fmt == "WEBP":
                img.save(out, format="WEBP", quality=80)
            else:
                img.save(out, format=fmt, optimize=True)
            return out.getvalue(), ext
    except Image.DecompressionBombError as exc:
        raise _ImageTooLargeError(str(exc)) from exc


def _resize_image(data: bytes) -> bytes:
    """Downscale an image so its longest edge is at most MAX_PHOTO_EDGE.

    Applies EXIF orientation (so phone photos are not stored rotated) and
    re-encodes the result, stripping metadata. Raises ``ValueError`` when the
    payload is not a supported raster image.
    """
    return _normalize_image(data)[0]


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
    photo_count = await db.scalar(
        select(func.count()).select_from(Photo).where(Photo.household_id == hh.id)
    )
    if (photo_count or 0) >= MAX_PHOTOS:
        raise HTTPException(status_code=429, detail="Photo limit reached")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Photo is too large")
    try:
        data, ext = _normalize_image(data)
    except _ImageTooLargeError as exc:
        raise HTTPException(status_code=413, detail="Photo is too large") from exc
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=415, detail="Unsupported or corrupt image") from exc
    filename = f"{uuid.uuid4()}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
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
