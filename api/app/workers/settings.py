from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import select

from app import updater_client
from app.config import settings as app_settings
from app.db import async_session
from app.events.publisher import publish_event
from app.models.all import Calendar, Household
from app.notifications.reminders import dispatch_due_reminders
from app.redis_client import get_redis
from app.system_state import (
    ACTIVE_JOB_STATES,
    is_major_update,
    is_managed,
    is_newer,
    merge_update_prefs,
    update_window_open,
)
from app.updates import fetch_releases
from app.version import VERSION

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"


async def sync_all_external_calendars(ctx):
    """Periodic job: fetch all external calendar feeds and upsert events."""
    async with async_session() as session:
        result = await session.execute(
            select(Calendar).where(Calendar.source != "internal")
        )
        calendars = result.scalars().all()
    for cal in calendars:
        await sync_calendar(ctx, cal.id)


async def dispatch_reminders(ctx):
    """Every-minute job: deliver reminders for upcoming events.

    Fans out to the HUD (SSE) and Web Push for events whose
    ``reminder_minutes`` offset has come due.
    """
    async with async_session() as session:
        logs = await dispatch_due_reminders(session)
    if logs:
        sent = sum(1 for log in logs if log.status == "sent")
        print(f"[worker] reminders: {sent}/{len(logs)} channel deliveries sent")


async def check_auto_update(ctx):
    """Periodic stable-channel auto-update, inside the household window."""

    if not updater_client.enabled():
        return

    async with async_session() as session:
        result = await session.execute(
            select(Household).where(Household.id == DEFAULT_HOUSEHOLD_ID)
        )
        household = result.scalar_one_or_none()
    household_settings = dict(household.settings or {}) if household else {}

    prefs = merge_update_prefs(household_settings.get("updates"))
    if not prefs["enabled"]:
        return
    if not update_window_open(prefs, household_settings.get("timezone")):
        return

    target = await updater_client.get_target()
    if not target:
        return
    managed, _ = is_managed(
        target, VERSION, app_settings.homst_self_update_disabled
    )
    if not managed:
        return

    feed = await fetch_releases()
    latest = feed.latest
    if not latest:
        return
    if not is_newer(VERSION, latest["version"]):
        return
    if is_major_update(VERSION, latest["version"]) and not prefs["allowMajor"]:
        print(
            f"[worker] auto-update: {latest['version']} is a major update; "
            "waiting for manual approval"
        )
        return

    status = await updater_client.get_status() or {}
    if (status.get("job") or {}).get("state") in ACTIVE_JOB_STATES:
        return
    if status.get("held_version") == latest["version"]:
        return

    try:
        redis = await get_redis()
        acquired = await redis.set(
            "homst:auto-update:lock", latest["version"], ex=1800, nx=True
        )
        if not acquired:
            return
    except Exception:
        return

    try:
        job = await updater_client.install(latest["version"], latest=True)
    except Exception as exc:
        print(f"[worker] auto-update failed to start: {exc}")
        return

    try:
        await publish_event(
            DEFAULT_HOUSEHOLD_ID,
            "system.update.starting",
            {"version": latest["version"], "job_id": job.get("id"), "auto": True},
        )
    except Exception:
        pass

    print(
        f"[worker] auto-update: installing {latest['version']} "
        f"(current {VERSION})"
    )


async def sync_calendar(ctx, calendar_id: str):
    """Sync a single external calendar by ID."""
    async with async_session() as session:
        result = await session.execute(
            select(Calendar).where(Calendar.id == calendar_id)
        )
        cal = result.scalar_one_or_none()
    if cal is None:
        print(f"[worker] Calendar {calendar_id} not found")
        return
    if cal.source == "ical" and cal.feed_url:
        # TODO: fetch iCal feed via httpx, parse with icalendar library,
        #       upsert events matched on external_uid
        print(f"[worker] Would fetch iCal from {cal.feed_url}")
    elif cal.source == "google":
        # TODO: fetch via Google Calendar API using stored credentials,
        #       upsert events matched on external_uid
        print(f"[worker] Would sync Google Calendar {cal.name}")
    else:
        print(f"[worker] Unsupported source {cal.source} for calendar {calendar_id}")


async def startup(ctx):
    print("[worker] ARQ worker started")


async def shutdown(ctx):
    print("[worker] ARQ worker shutting down")


class WorkerSettings:
    functions = [
        sync_all_external_calendars,
        sync_calendar,
        dispatch_reminders,
        check_auto_update,
    ]
    cron_jobs = [
        # Reminder scan: runs at second 0 of every minute.
        cron(dispatch_reminders),
        # Stable auto-update check; installs only inside the configured window.
        cron(check_auto_update, minute={0, 15, 30, 45}),
        # cron(sync_all_external_calendars, hour={*range(24)}, minute={0, 15, 30, 45})
    ]
    redis_settings = RedisSettings.from_dsn(app_settings.redis_url)
    on_startup = startup
    on_shutdown = shutdown
