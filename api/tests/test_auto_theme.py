from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from app.auto_theme import _sun_times, auto_theme_state, is_dark, solar_elevation
from app.workers import settings as worker

# ── Solar calculations ───────────────────────────────────────────────────────


def test_solar_elevation_day_and_night():
    noon = datetime(2026, 6, 21, 12, 0, tzinfo=timezone.utc)
    midnight = datetime(2026, 6, 21, 0, 0, tzinfo=timezone.utc)

    assert solar_elevation(51.5, -0.12, noon) > 0  # London, summer noon
    assert solar_elevation(51.5, -0.12, midnight) < 0
    assert is_dark(51.5, -0.12, midnight) is True
    assert is_dark(51.5, -0.12, noon) is False


def test_sun_times_bracket_the_local_day():
    sunrise, sunset = _sun_times(43.7, -79.4, "America/Toronto", date(2026, 10, 21))

    assert sunrise is not None and sunset is not None
    assert sunrise < sunset
    assert 6 <= sunrise.hour <= 9
    assert 17 <= sunset.hour <= 20
    assert sunrise.tzinfo is not None and sunset.tzinfo is not None


def test_sun_times_handle_polar_day_and_night():
    assert _sun_times(80.0, 0.0, "UTC", date(2026, 6, 21)) == (None, None)
    assert _sun_times(80.0, 0.0, "UTC", date(2026, 12, 21)) == (None, None)

    summer_noon = datetime(2026, 6, 21, 12, 0, tzinfo=timezone.utc)
    winter_noon = datetime(2026, 12, 21, 12, 0, tzinfo=timezone.utc)
    assert is_dark(80.0, 0.0, summer_noon) is False
    assert is_dark(80.0, 0.0, winter_noon) is True


def test_auto_state_only_resolves_for_auto_theme_with_coordinates():
    assert auto_theme_state({"theme": "light", "lat": 43.7, "lon": -79.4}) == {}
    assert auto_theme_state({"theme": "auto"}) == {}
    assert auto_theme_state({"theme": "auto", "lat": "nope", "lon": -79.4}) == {}

    state = auto_theme_state(
        {
            "theme": "auto",
            "lat": 43.7,
            "lon": -79.4,
            "timezone": "America/Toronto",
        },
        now=datetime(2026, 10, 21, 16, 0, tzinfo=timezone.utc),
    )
    assert state["autoThemeDark"] is False
    assert "autoSunrise" in state and "autoSunset" in state


def test_auto_state_falls_back_to_utc_for_bad_timezone():
    state = auto_theme_state(
        {
            "theme": "auto",
            "lat": 43.7,
            "lon": -79.4,
            "timezone": "Not/AZone",
        },
        now=datetime(2026, 10, 21, 16, 0, tzinfo=timezone.utc),
    )
    assert state["autoThemeDark"] is False
    assert "autoSunrise" in state


# ── Settings API ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_settings_api_resolves_auto_theme(client):
    r = await client.patch(
        "/api/v1/household/settings",
        json={
            "settings": {
                "theme": "auto",
                "lat": 43.7,
                "lon": -79.4,
                "timezone": "America/Toronto",
            }
        },
    )
    assert r.status_code == 200
    patch_settings = r.json()["settings"]
    assert isinstance(patch_settings["autoThemeDark"], bool)
    assert "autoSunrise" in patch_settings and "autoSunset" in patch_settings

    r = await client.get("/api/v1/household/settings")
    data = r.json()
    assert data["theme"] == "auto"
    assert isinstance(data["autoThemeDark"], bool)
    assert "autoSunrise" in data and "autoSunset" in data

    # Leaving auto drops the resolved flag so it cannot go stale.
    await client.patch("/api/v1/household/settings", json={"settings": {"theme": "light"}})
    r = await client.get("/api/v1/household/settings")
    assert "autoThemeDark" not in r.json()


@pytest.mark.asyncio
async def test_settings_api_auto_without_coordinates(client):
    r = await client.patch(
        "/api/v1/household/settings", json={"settings": {"theme": "auto"}}
    )
    assert r.status_code == 200
    assert "autoThemeDark" not in r.json()["settings"]

    r = await client.get("/api/v1/household/settings")
    assert "autoThemeDark" not in r.json()


# ── Worker ───────────────────────────────────────────────────────────────────


class _Result:
    def __init__(self, household):
        self.household = household

    def scalar_one_or_none(self):
        return self.household


class _Session:
    def __init__(self, household):
        self.household = household
        self.commits = 0

    async def execute(self, _stmt):
        return _Result(self.household)

    async def commit(self):
        self.commits += 1

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


def _patch_worker(monkeypatch, household):
    session = _Session(household)
    monkeypatch.setattr(worker, "async_session", lambda: session)
    events = []

    async def fake_publish(household_id, event_type, data):
        events.append((household_id, event_type, data))

    monkeypatch.setattr(worker, "publish_event", fake_publish)
    return session, events


@pytest.mark.asyncio
async def test_worker_switches_every_client_at_sunset_and_sunrise(monkeypatch):
    household = SimpleNamespace(
        settings={
            "theme": "auto",
            "lat": 43.7,
            "lon": -79.4,
            "timezone": "America/Toronto",
            "autoThemeDark": True,
        }
    )
    session, events = _patch_worker(monkeypatch, household)

    # Noon in Toronto: the household is already marked dark, so flip to light.
    noon = datetime(2026, 10, 21, 16, 0, tzinfo=timezone.utc)
    await worker.apply_auto_theme(None, now=noon)
    assert household.settings["autoThemeDark"] is False
    assert session.commits == 1
    assert len(events) == 1
    assert events[0][1] == "settings.updated"
    assert events[0][2]["settings"]["autoThemeDark"] is False

    # Same state again: no duplicate push.
    await worker.apply_auto_theme(None, now=noon)
    assert session.commits == 1
    assert len(events) == 1

    # Midnight in Toronto: push dark to every connected screen.
    midnight = datetime(2026, 10, 22, 4, 0, tzinfo=timezone.utc)
    await worker.apply_auto_theme(None, now=midnight)
    assert household.settings["autoThemeDark"] is True
    assert session.commits == 2
    assert len(events) == 2
    assert events[1][2]["settings"]["autoThemeDark"] is True


@pytest.mark.asyncio
async def test_worker_ignores_manual_themes_and_missing_household(monkeypatch):
    household = SimpleNamespace(settings={"theme": "dark"})
    session, events = _patch_worker(monkeypatch, household)

    await worker.apply_auto_theme(None)
    assert session.commits == 0
    assert events == []

    session, events = _patch_worker(monkeypatch, None)
    await worker.apply_auto_theme(None)
    assert session.commits == 0
    assert events == []
