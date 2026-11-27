"""Smart chat screenshots: storage, validation and conversation links.

An attached picture is re-encoded and kept on the uploads volume so a saved
conversation can show it again. These tests use the real filesystem and clean
up after themselves, like test_photos.py.
"""

import base64
import io
import os
import uuid

import pytest
from PIL import Image

from app import ai
from app.routers.ai import CHAT_IMAGE_DIR


def _data_url(size: tuple[int, int] = (24, 24), fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    Image.new("RGB", size, (12, 130, 200)).save(buf, fmt)
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    mime = "jpeg" if fmt == "JPEG" else "png"
    return f"data:image/{mime};base64,{encoded}"


def _stored_path(url: str) -> str:
    return os.path.join(CHAT_IMAGE_DIR, url.rsplit("/", 1)[-1])


@pytest.fixture
def written():
    """Remove whatever the test put on the uploads volume."""
    paths: list[str] = []
    yield paths
    for path in paths:
        if os.path.exists(path):
            os.remove(path)


@pytest.mark.asyncio
async def test_stores_a_screenshot_and_serves_it(client, written):
    resp = await client.post(
        "/api/v1/ai/images",
        json={"image": _data_url(), "name": "school-letter.png"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "school-letter.png"
    assert body["url"].startswith("/uploads/chats/")
    assert body["url"].endswith(".png")
    path = _stored_path(body["url"])
    written.append(path)
    assert os.path.exists(path)

    served = await client.get(body["url"])
    assert served.status_code == 200
    # UUID filenames never change, so the browser may reuse its copy.
    assert served.headers["cache-control"] == "public, max-age=604800"


@pytest.mark.asyncio
async def test_keeps_the_label_but_names_the_file_with_a_uuid(client, written):
    resp = await client.post(
        "/api/v1/ai/images",
        json={"image": _data_url(), "name": "  my  shot .png "},
    )
    assert resp.status_code == 201
    body = resp.json()
    path = _stored_path(body["url"])
    written.append(path)
    stem = os.path.basename(path).removesuffix(".png")
    uuid.UUID(stem)  # the file on disk is a fresh uuid, never the user's name
    assert body["name"] == "my shot .png"


@pytest.mark.asyncio
async def test_downscales_a_large_screenshot(client, written):
    resp = await client.post(
        "/api/v1/ai/images",
        json={"image": _data_url((4000, 1000)), "name": "wide.png"},
    )
    assert resp.status_code == 201
    path = _stored_path(resp.json()["url"])
    written.append(path)
    with Image.open(path) as stored:
        assert stored.width == ai.MAX_IMAGE_EDGE
        assert stored.height == ai.MAX_IMAGE_EDGE // 4


@pytest.mark.asyncio
async def test_reencodes_a_jpeg_upload_as_png(client, written):
    """The stored copy comes from the same path as the copy sent to the model."""
    resp = await client.post(
        "/api/v1/ai/images",
        json={"image": _data_url((64, 64), "JPEG"), "name": "photo.jpg"},
    )
    assert resp.status_code == 201
    path = _stored_path(resp.json()["url"])
    written.append(path)
    with open(path, "rb") as handle:
        assert handle.read(8) == b"\x89PNG\r\n\x1a\n"


@pytest.mark.asyncio
async def test_rejects_a_payload_that_is_not_an_image(client):
    before = set(os.listdir(CHAT_IMAGE_DIR))
    resp = await client.post(
        "/api/v1/ai/images",
        json={
            "image": "data:text/plain;base64,"
            + base64.b64encode(b"hello there").decode("ascii"),
            "name": "notes.txt",
        },
    )
    assert resp.status_code == 415
    assert set(os.listdir(CHAT_IMAGE_DIR)) == before


@pytest.mark.asyncio
async def test_rejects_an_oversized_screenshot(client):
    payload = base64.b64encode(b"\x00" * (ai.MAX_IMAGE_BYTES + 1)).decode("ascii")
    resp = await client.post(
        "/api/v1/ai/images",
        json={"image": f"data:image/png;base64,{payload}"},
    )
    assert resp.status_code == 415


@pytest.mark.asyncio
async def test_conversation_round_trips_the_image_url(client):
    resp = await client.post(
        "/api/v1/ai/conversations",
        json={
            "title": "School letter",
            "turns": [
                {
                    "role": "user",
                    "text": "Here's the letter",
                    "image_name": "letter.png",
                    "image_url": "/uploads/chats/letter-1.png",
                }
            ],
        },
    )
    assert resp.status_code == 201
    saved = resp.json()
    assert saved["turns"][0]["image_url"] == "/uploads/chats/letter-1.png"

    reloaded = await client.get(f"/api/v1/ai/conversations/{saved['id']}")
    turn = reloaded.json()["turns"][0]
    assert turn["image_url"] == "/uploads/chats/letter-1.png"
    assert turn["image_name"] == "letter.png"
