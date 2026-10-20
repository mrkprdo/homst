import time

import pytest
from sqlalchemy import select

from app.models.all import Household
from app.routers import system as system_router
from app.updates import ReleaseFeed

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"


def _feed() -> ReleaseFeed:
    return ReleaseFeed(
        releases=[
            {
                "version": "0.3.0",
                "tag": "0.3.0",
                "name": "0.3.0",
                "published_at": "2026-10-01T00:00:00Z",
                "html_url": "https://example.com/v0.3.0",
                "notes": "Release notes",
            },
            {
                "version": "0.2.0",
                "tag": "0.2.0",
                "name": "0.2.0",
                "published_at": "2026-09-01T00:00:00Z",
                "html_url": "https://example.com/v0.2.0",
                "notes": "",
            },
        ],
        checked_at=time.time(),
    )


def _target(image: str = "ghcr.io/mrkprdo/homst:latest", labels: dict | None = None):
    return {
        "image": image,
        "labels": labels or {},
        "version": "0.2.0",
    }


@pytest.mark.asyncio
async def test_system_status_managed_update_available(client, monkeypatch):
    async def fake_fetch(force=False):
        return _feed()

    async def fake_target():
        return _target()

    async def fake_status():
        return {"previous_version": None, "held_version": None, "job": None}

    monkeypatch.setattr(system_router, "VERSION", "0.2.0")
    monkeypatch.setattr(system_router, "fetch_releases", fake_fetch)
    monkeypatch.setattr(system_router.updater_client, "get_target", fake_target)
    monkeypatch.setattr(system_router.updater_client, "get_status", fake_status)

    response = await client.get("/api/v1/system/status")
    assert response.status_code == 200
    data = response.json()
    assert data["current"]["version"] == "0.2.0"
    assert data["latest"]["version"] == "0.3.0"
    assert data["latest"]["held"] is False
    assert data["latest"]["major"] is False
    assert data["update_available"] is True
    assert data["self_update"]["managed"] is True
    assert data["releases"][0]["newer"] is True
    assert data["auto"] == {"enabled": True, "checkIntervalMinutes": 5}
    assert data["update_prompt"] == {"version": "0.3.0", "dismissed": False}


@pytest.mark.asyncio
async def test_system_status_does_not_prompt_when_checks_are_disabled(
    client, db_session, monkeypatch
):
    async def fake_fetch(force=False):
        return _feed()

    async def fake_target():
        return _target()

    async def fake_status():
        return {"previous_version": None, "held_version": None, "job": None}

    db_session.add(
        Household(
            id=DEFAULT_HOUSEHOLD_ID,
            name="Home",
            settings={"updates": {"enabled": False}},
        )
    )
    await db_session.commit()

    monkeypatch.setattr(system_router, "VERSION", "0.2.0")
    monkeypatch.setattr(system_router, "fetch_releases", fake_fetch)
    monkeypatch.setattr(system_router.updater_client, "get_target", fake_target)
    monkeypatch.setattr(system_router.updater_client, "get_status", fake_status)

    response = await client.get("/api/v1/system/status")
    data = response.json()

    assert data["update_available"] is True
    assert data["auto"]["enabled"] is False
    assert data["update_prompt"] == {"version": None, "dismissed": False}


@pytest.mark.asyncio
async def test_system_status_nightly_is_manual(client, monkeypatch):
    async def fake_fetch(force=False):
        return _feed()

    async def fake_target():
        return _target("ghcr.io/mrkprdo/homst:dev", {})

    async def fake_status():
        return {}

    monkeypatch.setattr(system_router, "VERSION", "dev")
    monkeypatch.setattr(system_router, "fetch_releases", fake_fetch)
    monkeypatch.setattr(system_router.updater_client, "get_target", fake_target)
    monkeypatch.setattr(system_router.updater_client, "get_status", fake_status)

    response = await client.get("/api/v1/system/status")
    data = response.json()
    assert data["self_update"]["managed"] is False
    assert data["update_available"] is False
    assert "Nightly" in data["self_update"]["reason"]
    assert data["current"]["channel"] == "nightly"


@pytest.mark.asyncio
async def test_system_status_without_updater(client, monkeypatch):
    async def fake_fetch(force=False):
        return _feed()

    async def fake_none():
        return None

    monkeypatch.setattr(system_router, "VERSION", "0.2.0")
    monkeypatch.setattr(system_router, "fetch_releases", fake_fetch)
    monkeypatch.setattr(system_router.updater_client, "get_target", fake_none)
    monkeypatch.setattr(system_router.updater_client, "get_status", fake_none)

    response = await client.get("/api/v1/system/status")
    data = response.json()
    assert data["self_update"]["available"] is False
    assert data["self_update"]["managed"] is False
    assert data["manual"]["current"]


@pytest.mark.asyncio
async def test_install_requires_confirmation_header(client, monkeypatch):
    response = await client.post(
        "/api/v1/system/install", json={"version": "0.3.0"}
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_install_rejects_unknown_release(client, monkeypatch):
    async def fake_fetch(force=False):
        return _feed()

    async def fake_target():
        return _target()

    async def fake_status():
        return {}

    monkeypatch.setattr(system_router, "VERSION", "0.2.0")
    monkeypatch.setattr(system_router, "fetch_releases", fake_fetch)
    monkeypatch.setattr(system_router.updater_client, "get_target", fake_target)
    monkeypatch.setattr(system_router.updater_client, "get_status", fake_status)

    response = await client.post(
        "/api/v1/system/install",
        json={"version": "9.9.9"},
        headers={"X-HOMST-Update": "1"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_install_triggers_updater(client, monkeypatch):
    calls = []

    async def fake_fetch(force=False):
        return _feed()

    async def fake_target():
        return _target()

    async def fake_status():
        return {"previous_version": "0.1.0", "held_version": None, "job": None}

    async def fake_install(version, latest):
        calls.append((version, latest))
        return {"id": "job-1", "state": "queued", "version": version}

    async def fake_publish(*args, **kwargs):
        return None

    monkeypatch.setattr(system_router, "VERSION", "0.2.0")
    monkeypatch.setattr(system_router, "fetch_releases", fake_fetch)
    monkeypatch.setattr(system_router.updater_client, "get_target", fake_target)
    monkeypatch.setattr(system_router.updater_client, "get_status", fake_status)
    monkeypatch.setattr(system_router.updater_client, "install", fake_install)
    monkeypatch.setattr(system_router, "publish_event", fake_publish)

    response = await client.post(
        "/api/v1/system/install",
        json={"version": "0.3.0"},
        headers={"X-HOMST-Update": "1"},
    )
    assert response.status_code == 202
    assert response.json()["id"] == "job-1"
    assert calls == [("0.3.0", True)]


@pytest.mark.asyncio
async def test_install_rejects_held_version_without_retry(client, monkeypatch):
    async def fake_fetch(force=False):
        return _feed()

    async def fake_target():
        return _target()

    async def fake_status():
        return {"held_version": "0.3.0", "held_reason": "failed"}

    monkeypatch.setattr(system_router, "VERSION", "0.2.0")
    monkeypatch.setattr(system_router, "fetch_releases", fake_fetch)
    monkeypatch.setattr(system_router.updater_client, "get_target", fake_target)
    monkeypatch.setattr(system_router.updater_client, "get_status", fake_status)

    response = await client.post(
        "/api/v1/system/install",
        json={"version": "0.3.0"},
        headers={"X-HOMST-Update": "1"},
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_system_status_marks_dismissed_prompt(client, db_session, monkeypatch):
    async def fake_fetch(force=False):
        return _feed()

    async def fake_target():
        return _target()

    async def fake_status():
        return {"previous_version": None, "held_version": None, "job": None}

    db_session.add(
        Household(
            id=DEFAULT_HOUSEHOLD_ID,
            name="Home",
            settings={"updateDismissedVersion": "0.3.0"},
        )
    )
    await db_session.commit()

    monkeypatch.setattr(system_router, "VERSION", "0.2.0")
    monkeypatch.setattr(system_router, "fetch_releases", fake_fetch)
    monkeypatch.setattr(system_router.updater_client, "get_target", fake_target)
    monkeypatch.setattr(system_router.updater_client, "get_status", fake_status)

    response = await client.get("/api/v1/system/status")
    data = response.json()

    assert data["update_available"] is True
    assert data["update_prompt"] == {"version": None, "dismissed": True}


@pytest.mark.asyncio
async def test_dismiss_prompt_requires_confirmation_header(client):
    response = await client.post(
        "/api/v1/system/prompt/dismiss", json={"version": "0.3.0"}
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_dismiss_prompt_persists_and_publishes(client, db_session, monkeypatch):
    db_session.add(Household(id=DEFAULT_HOUSEHOLD_ID, name="Home", settings={}))
    await db_session.commit()

    events = []

    async def fake_publish(household_id, event_type, data):
        events.append((household_id, event_type, data))

    monkeypatch.setattr(system_router, "publish_event", fake_publish)

    response = await client.post(
        "/api/v1/system/prompt/dismiss",
        json={"version": "0.3.0"},
        headers={"X-HOMST-Update": "1"},
    )
    assert response.status_code == 200
    assert response.json() == {"dismissed": "0.3.0"}

    result = await db_session.execute(
        select(Household).where(Household.id == DEFAULT_HOUSEHOLD_ID)
    )
    household = result.scalar_one()
    assert household.settings["updateDismissedVersion"] == "0.3.0"
    assert events == [
        (
            DEFAULT_HOUSEHOLD_ID,
            "system.update.dismissed",
            {"version": "0.3.0"},
        )
    ]
