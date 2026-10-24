import io
import os
import struct
import zlib

import pytest
from PIL import Image

from app.routers.photos import MAX_PHOTO_EDGE, MAX_UPLOAD_BYTES

UPLOAD_DIR = "uploads/photos"


def _make_image(size: tuple[int, int], fmt: str = "JPEG") -> io.BytesIO:
    img = Image.new("RGB", size, (200, 60, 60))
    buf = io.BytesIO()
    img.save(buf, fmt)
    buf.seek(0)
    return buf


def _image_bytes(size: tuple[int, int], fmt: str = "JPEG") -> bytes:
    return _make_image(size, fmt).getvalue()


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    crc = zlib.crc32(kind + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)


def _png_with_dimensions(width: int, height: int) -> bytes:
    """Return a valid PNG whose IHDR claims ``width`` x ``height`` pixels."""
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    # Valid (tiny) RGB payload; the header is what the guards look at first.
    raw = b"".join(b"\x00" + b"\x00\x00\x00" * 2 for _ in range(2))
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", zlib.compress(raw))
        + _png_chunk(b"IEND", b"")
    )


def _stored_path(url: str) -> str:
    # url looks like /uploads/photos/<filename>
    filename = url.rsplit("/", 1)[-1]
    return os.path.join(UPLOAD_DIR, filename)


def _uploaded_files() -> set[str]:
    return set(os.listdir(UPLOAD_DIR))


@pytest.mark.asyncio
async def test_upload_scales_large_image_down(client):
    buf = _make_image((4000, 3000))
    resp = await client.post(
        "/api/v1/photos", files={"file": ("big.jpg", buf, "image/jpeg")}
    )
    assert resp.status_code == 201
    photo = resp.json()
    path = _stored_path(photo["url"])
    try:
        with Image.open(path) as img:
            assert img.width == MAX_PHOTO_EDGE
            assert img.height == 960
            # Aspect ratio preserved: 4000:3000 == 1280:960
            assert img.width / img.height == pytest.approx(4000 / 3000, rel=1e-2)
    finally:
        if os.path.exists(path):
            os.remove(path)


@pytest.mark.asyncio
async def test_upload_keeps_small_image_unchanged(client):
    buf = _make_image((800, 600), fmt="PNG")
    resp = await client.post(
        "/api/v1/photos", files={"file": ("small.png", buf, "image/png")}
    )
    assert resp.status_code == 201
    photo = resp.json()
    path = _stored_path(photo["url"])
    try:
        with Image.open(path) as img:
            assert img.width == 800
            assert img.height == 600
    finally:
        if os.path.exists(path):
            os.remove(path)


@pytest.mark.asyncio
async def test_upload_non_image_is_rejected_without_writing(client):
    before = _uploaded_files()
    resp = await client.post(
        "/api/v1/photos",
        files={"file": ("note.txt", io.BytesIO(b"hello world"), "text/plain")},
    )
    assert resp.status_code == 415
    assert _uploaded_files() == before


@pytest.mark.asyncio
async def test_upload_rejects_gif(client):
    before = _uploaded_files()
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), (1, 2, 3)).save(buf, "GIF")
    buf.seek(0)
    resp = await client.post(
        "/api/v1/photos", files={"file": ("anim.gif", buf, "image/gif")}
    )
    assert resp.status_code == 415
    assert _uploaded_files() == before


@pytest.mark.asyncio
async def test_upload_derives_extension_from_content_not_filename(client):
    resp = await client.post(
        "/api/v1/photos",
        files={"file": ("disguised.txt", io.BytesIO(_image_bytes((20, 20), "PNG")), "text/plain")},
    )
    assert resp.status_code == 201
    photo = resp.json()
    url = photo["url"]
    path = _stored_path(url)
    try:
        assert url.endswith(".png")
        assert not url.endswith(".txt")
        with open(path, "rb") as f:
            assert f.read(8) == b"\x89PNG\r\n\x1a\n"
    finally:
        if os.path.exists(path):
            os.remove(path)


@pytest.mark.asyncio
async def test_upload_rejects_oversized_body(client):
    before = _uploaded_files()
    oversized = b"\x00" * (MAX_UPLOAD_BYTES + 1)
    resp = await client.post(
        "/api/v1/photos",
        files={"file": ("huge.jpg", io.BytesIO(oversized), "image/jpeg")},
    )
    assert resp.status_code == 413
    assert _uploaded_files() == before


@pytest.mark.asyncio
async def test_upload_rejects_decompression_bomb(client):
    before = _uploaded_files()
    # Far more pixels than Pillow's own bomb guard allows.
    bomb = _png_with_dimensions(30000, 30000)
    resp = await client.post(
        "/api/v1/photos",
        files={"file": ("bomb.png", io.BytesIO(bomb), "image/png")},
    )
    assert resp.status_code == 413
    assert _uploaded_files() == before


@pytest.mark.asyncio
async def test_upload_rejects_absurd_pixel_count(client):
    before = _uploaded_files()
    # Below Pillow's bomb threshold but above the application's 40 MP cap.
    huge = _png_with_dimensions(6400, 6400)
    resp = await client.post(
        "/api/v1/photos",
        files={"file": ("huge.png", io.BytesIO(huge), "image/png")},
    )
    assert resp.status_code == 413
    assert _uploaded_files() == before


@pytest.mark.asyncio
async def test_upload_enforces_household_photo_cap(client, monkeypatch):
    from app.routers import photos as photos_router

    monkeypatch.setattr(photos_router, "MAX_PHOTOS", 1)

    first = await client.post(
        "/api/v1/photos",
        files={"file": ("one.png", io.BytesIO(_image_bytes((20, 20), "PNG")), "image/png")},
    )
    assert first.status_code == 201
    path = _stored_path(first.json()["url"])
    try:
        before = _uploaded_files()
        second = await client.post(
            "/api/v1/photos",
            files={"file": ("two.png", io.BytesIO(_image_bytes((20, 20), "PNG")), "image/png")},
        )
        assert second.status_code == 429
        assert _uploaded_files() == before
    finally:
        if os.path.exists(path):
            os.remove(path)


@pytest.mark.asyncio
async def test_photo_mutations_broadcast_to_the_fleet(client, monkeypatch):
    """Every photo mutation must notify other connected clients over SSE."""
    from app.routers import photos as photos_router

    calls: list[tuple[str, str, dict]] = []

    async def fake_publish(household_id, event_type, data):
        calls.append((household_id, event_type, data))

    monkeypatch.setattr(photos_router, "publish_event", fake_publish)

    buf = _make_image((100, 100))
    resp = await client.post(
        "/api/v1/photos", files={"file": ("p.jpg", buf, "image/jpeg")}
    )
    assert resp.status_code == 201
    photo = resp.json()
    path = _stored_path(photo["url"])
    try:
        r = await client.patch(f"/api/v1/photos/{photo['id']}", json={"selected": True})
        assert r.status_code == 200
        r = await client.delete(f"/api/v1/photos/{photo['id']}")
        assert r.status_code == 204
    finally:
        if os.path.exists(path):
            os.remove(path)

    assert [c[1] for c in calls] == ["photos.updated"] * 3
