import io
import os

import pytest
from PIL import Image

from app.routers.photos import MAX_PHOTO_EDGE

UPLOAD_DIR = "uploads/photos"


def _make_image(size: tuple[int, int], fmt: str = "JPEG") -> io.BytesIO:
    img = Image.new("RGB", size, (200, 60, 60))
    buf = io.BytesIO()
    img.save(buf, fmt)
    buf.seek(0)
    return buf


def _stored_path(url: str) -> str:
    # url looks like /uploads/photos/<filename>
    filename = url.rsplit("/", 1)[-1]
    return os.path.join(UPLOAD_DIR, filename)


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
async def test_upload_non_image_stored_verbatim(client):
    resp = await client.post(
        "/api/v1/photos",
        files={"file": ("note.txt", io.BytesIO(b"hello world"), "text/plain")},
    )
    assert resp.status_code == 201
    photo = resp.json()
    path = _stored_path(photo["url"])
    try:
        with open(path, "rb") as f:
            assert f.read() == b"hello world"
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
