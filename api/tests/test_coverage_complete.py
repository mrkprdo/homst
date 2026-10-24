"""Coverage for defensive branches, failure paths, and the updater sidecar.

These tests deliberately exercise the error and recovery paths that the happy
path suite does not reach. They are grouped by module to keep failures easy to
locate.
"""

import json
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.models.all import PushSubscription
from app.system_state import ImageRef, is_managed, merge_update_prefs
from app.updater.state import StateStore, default_state

# ══════════════════════════════════════════════════════════════════════
# system_state
# ══════════════════════════════════════════════════════════════════════


def test_image_ref_parsing_covers_empty_digest_and_implicit_latest():
    assert ImageRef.parse(None) == ImageRef("", None, None)
    assert ImageRef.parse("   ") == ImageRef("", None, None)
    assert ImageRef.parse("ghcr.io/owner/app@sha256:abc") == ImageRef(
        "ghcr.io/owner/app", None, "sha256:abc"
    )
    assert ImageRef.parse("ghcr.io/owner/app") == ImageRef(
        "ghcr.io/owner/app", "latest", None
    )


def test_is_managed_refuses_disabled_digest_and_development_installs():
    assert is_managed(None, "0.2.0", self_update_disabled=True)[0] is False
    assert is_managed(None, "0.2.0")[1] == "The updater service is not running."

    digest_target = {"image": "ghcr.io/mrkprdo/homst@sha256:abc"}
    assert is_managed(digest_target, "0.2.0")[1] == (
        "This container runs from an image digest."
    )

    assert is_managed(
        {"image": "ghcr.io/mrkprdo/homst:latest"}, "dev"
    )[1] == "This is a development build."


def test_merge_update_prefs_ignores_bad_values():
    assert merge_update_prefs(None) == {
        "enabled": True,
        "checkIntervalMinutes": 5,
    }
    assert merge_update_prefs({"enabled": 0, "checkIntervalMinutes": "nope"}) == {
        "enabled": False,
        "checkIntervalMinutes": 5,
    }
    assert merge_update_prefs({"checkIntervalMinutes": 0})["checkIntervalMinutes"] == 5
    assert merge_update_prefs({"checkIntervalMinutes": 60})["checkIntervalMinutes"] == 60


# ══════════════════════════════════════════════════════════════════════
# auto_theme
# ══════════════════════════════════════════════════════════════════════


def test_auto_theme_accepts_naive_times_and_rejects_non_finite_coordinates():
    from app.auto_theme import auto_theme_state, solar_elevation

    naive = datetime(2026, 6, 21, 12, 0)
    assert solar_elevation(51.5, -0.12, naive) > 0

    state = auto_theme_state(
        {"theme": "auto", "lat": 43.7, "lon": -79.4},
        now=datetime(2026, 10, 21, 16, 0),
    )
    assert state["autoThemeDark"] is False

    assert auto_theme_state(
        {"theme": "auto", "lat": float("nan"), "lon": 0}
    ) == {}


# ══════════════════════════════════════════════════════════════════════
# notifications/push
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_vapid_keys_repair_invalid_json_and_integrity_race(db_session):
    from app.models.all import ServerSetting
    from app.notifications import push

    db_session.add(ServerSetting(key="vapid", value="not-json"))
    await db_session.commit()

    public, private = await push.get_vapid_keys(db_session)
    assert public and private
    row = await db_session.get(ServerSetting, "vapid")
    assert json.loads(row.value)["public"] == public

    class RaceSession:
        def __init__(self, wallet):
            self.wallet = wallet
            self.commits = 0
            self.rolled_back = False
            self.gets = 0

        async def get(self, _model, _key):
            self.gets += 1
            if self.gets == 1:
                return SimpleNamespace(value="{not-json")
            return SimpleNamespace(value=json.dumps(self.wallet))

        async def commit(self):
            self.commits += 1
            raise IntegrityError("stmt", {}, Exception("duplicate"))

        async def rollback(self):
            self.rolled_back = True

    race = RaceSession({"public": "race-public", "private": "race-private"})
    assert await push.get_vapid_keys(race) == ("race-public", "race-private")
    assert race.rolled_back is True


@pytest.mark.asyncio
async def test_deliver_push_prunes_gone_devices_and_reports_failures(
    db_session, monkeypatch
):
    from pywebpush import WebPushException

    from app.notifications import push

    gone = PushSubscription(
        household_id="00000000-0000-0000-0000-000000000000",
        endpoint="https://fcm.googleapis.com/gone",
        p256dh="p",
        auth="a",
    )
    failing = PushSubscription(
        household_id="00000000-0000-0000-0000-000000000000",
        endpoint="https://fcm.googleapis.com/fail",
        p256dh="p",
        auth="a",
    )
    exploding = PushSubscription(
        household_id="00000000-0000-0000-0000-000000000000",
        endpoint="https://fcm.googleapis.com/boom",
        p256dh="p",
        auth="a",
    )
    db_session.add_all([gone, failing, exploding])
    await db_session.commit()

    async def fake_webpush(subscription_info, **_kwargs):
        if subscription_info["endpoint"].endswith("/gone"):
            raise WebPushException("gone", response=SimpleNamespace(status_code=410))
        if subscription_info["endpoint"].endswith("/fail"):
            raise WebPushException("nope", response=SimpleNamespace(status_code=500))
        raise RuntimeError("crypto exploded")

    monkeypatch.setattr(push, "webpush_async", fake_webpush)

    ok, detail = await push.deliver_push(
        db_session,
        [gone, failing, exploding],
        {"title": "Hi"},
        private_key="k",
        subject="mailto:x@example.com",
    )
    assert ok is False
    assert "0/3 delivered" in detail
    assert "pruned 1" in detail
    assert "500" in detail and "RuntimeError" in detail
    assert await db_session.get(PushSubscription, gone.id) is None


@pytest.mark.asyncio
async def test_deliver_push_without_subscriptions(db_session):
    from app.notifications import push

    assert await push.deliver_push(
        db_session, [], {}, private_key="k", subject="mailto:x@example.com"
    ) == (False, "no push subscriptions")


# ══════════════════════════════════════════════════════════════════════
# updater/state
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_state_store_survives_corrupt_files_and_clears_missing_journal(tmp_path):
    (tmp_path / "state.json").write_text("{not json", encoding="utf-8")
    (tmp_path / "journal.json").write_text("[]", encoding="utf-8")
    store = StateStore(str(tmp_path))

    assert (await store.snapshot())["current_version"] is None
    await store.clear_journal()  # journal exists the first time
    await store.clear_journal()  # already gone -> FileNotFoundError swallowed
    assert await store.journal() is None
    assert default_state()["history"] == []


# ══════════════════════════════════════════════════════════════════════
# routers: publish failures must never fail a write
# ══════════════════════════════════════════════════════════════════════


async def _make_task_list(client, name="List"):
    r = await client.post("/api/v1/task-lists", json={"name": name})
    assert r.status_code == 201
    return r.json()["id"]


async def _make_task(client, list_id, title="Task"):
    r = await client.post(
        "/api/v1/tasks", json={"list_id": list_id, "title": title}
    )
    assert r.status_code == 201
    return r.json()


@pytest.mark.asyncio
async def test_task_endpoints_ignore_broadcast_failures(client, monkeypatch):
    from app.routers import tasks as tasks_router

    async def boom(*_args, **_kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr(tasks_router, "publish_event", boom)

    list_id = await _make_task_list(client)
    task = await _make_task(client, list_id)

    assert (
        await client.patch(f"/api/v1/task-lists/{list_id}", json={"name": "Renamed"})
    ).status_code == 200

    assert (
        await client.patch(f"/api/v1/tasks/{task['id']}", json={"title": "Updated"})
    ).status_code == 200
    assert (
        await client.patch(
            f"/api/v1/tasks/{task['id']}/move",
            json={"list_id": list_id, "position": 3},
        )
    ).status_code == 200
    assert (await client.delete(f"/api/v1/tasks/{task['id']}")).status_code == 200
    assert (await client.delete(f"/api/v1/task-lists/{list_id}")).status_code == 200


@pytest.mark.asyncio
async def test_member_endpoints_ignore_broadcast_failures(client, monkeypatch):
    from app.routers import users as users_router

    async def boom(*_args, **_kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr(users_router, "publish_event", boom)

    r = await client.post("/api/v1/household/members", json={"name": "Alice"})
    assert r.status_code == 201
    member_id = r.json()["id"]

    assert (
        await client.patch(
            f"/api/v1/household/members/{member_id}", json={"name": "Alicia"}
        )
    ).status_code == 200
    assert (
        await client.delete(f"/api/v1/household/members/{member_id}")
    ).status_code == 200


@pytest.mark.asyncio
async def test_calendar_endpoints_ignore_broadcast_failures(client, monkeypatch):
    from app.routers import calendar as calendar_router

    async def boom(*_args, **_kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr(calendar_router, "publish_event", boom)

    r = await client.post("/api/v1/calendars", json={"name": "Home", "color": "sage"})
    cal_id = r.json()["id"]
    r = await client.post(
        "/api/v1/events",
        json={
            "calendar_id": cal_id,
            "title": "Dinner",
            "start_at": "2030-06-01T18:00:00Z",
            "end_at": "2030-06-01T19:00:00Z",
        },
    )
    event_id = r.json()["id"]

    assert (
        await client.patch(f"/api/v1/events/{event_id}", json={"title": "Lunch"})
    ).status_code == 200
    assert (await client.delete(f"/api/v1/events/{event_id}")).status_code == 200


@pytest.mark.asyncio
async def test_announcement_push_skips_without_devices_and_survives_errors(
    client, monkeypatch
):
    from app.routers import announcements as announcements_router

    async def boom(*_args, **_kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr(announcements_router, "publish_event", boom)

    # No push subscriptions: the push helper returns early.
    r = await client.post(
        "/api/v1/announcements",
        json={"message": "No devices", "send_push": True},
    )
    assert r.status_code == 201

    # A broken push service must not fail the announcement.
    from app.notifications import push as push_module

    async def explode(*_args, **_kwargs):
        raise RuntimeError("vapid exploded")

    monkeypatch.setattr(push_module, "subscriptions_for", explode)
    r = await client.post(
        "/api/v1/announcements",
        json={"message": "Push broken", "send_push": True},
    )
    assert r.status_code == 201

    # Deleting still succeeds when the broadcast fails.
    assert (
        await client.delete(f"/api/v1/announcements/{r.json()['id']}")
    ).status_code == 200


# ══════════════════════════════════════════════════════════════════════
# routers/system helper branches
# ══════════════════════════════════════════════════════════════════════


def test_host_only_handles_empty_and_port_values():
    from app.routers.system import _channel, _host_only

    assert _host_only(None) == ""
    assert _host_only("") == ""
    assert _host_only("homst.local:8443") == "homst.local"
    assert _host_only("https://homst.local:8443") == "homst.local"

    assert _channel("0.2.0", {"image": "ghcr.io/other/app:latest"}) == "custom"
    assert _channel("0.2.0", {"image": "ghcr.io/mrkprdo/homst@sha256:x"}) == "pinned"
    assert _channel("0.2.0", {"image": "ghcr.io/mrkprdo/homst:0.2.0"}) == "pinned"
    assert _channel(
        "0.2.0",
        {
            "image": "ghcr.io/mrkprdo/homst:0.2.0",
            "labels": {"homst.managed": "true"},
        },
    ) == "stable"


def test_require_update_header_rejects_missing_or_cross_origin():
    from app.routers.system import _require_update_header

    request = SimpleNamespace(
        headers={
            "x-homst-update": "1",
            "origin": "https://evil.example",
            "host": "homst.local",
        }
    )
    with pytest.raises(HTTPException) as exc:
        _require_update_header(request)
    assert exc.value.status_code == 403

    request = SimpleNamespace(headers={"x-homst-update": "1", "origin": ""})
    assert _require_update_header(request) is None
