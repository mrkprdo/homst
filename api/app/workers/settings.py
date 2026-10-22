import time

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import select

from app import updater_client
from app.auto_theme import auto_theme_state
from app.config import settings as app_settings
from app.db import async_session
from app.events.publisher import publish_event
from app.models.all import Calendar, Household
from app.notifications.reminders import dispatch_due_reminders
from app.system_state import (
    ACTIVE_JOB_STATES,
    is_major_update,
    is_managed,
    is_newer,
    merge_update_prefs,
)
from app.updates import fetch_releases
from app.version import VERSION

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"

# The worker cron ticks every minute; this gate keeps the actual release check
# at the household's configured interval (5 minutes by default).
_last_update_check = 0.0


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


def _check_due(interval_minutes: int, now: float | None = None) -> bool:
    """Return True when the configured release-check interval has elapsed."""
    global _last_update_check

    current = time.monotonic() if now is None else now
    if _last_update_check and current - _last_update_check < interval_minutes * 60:
        return False
    _last_update_check = current
    return True


async def check_auto_update(ctx):
    """Check the stable channel and ask displays to install a new release.

    Nothing is installed silently: connected display clients receive a prompt
    with Yes/No over the SSE stream. A dismissed version is remembered so the
    same release is not offered again until a newer one is published.
    """

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
    if not _check_due(prefs["checkIntervalMinutes"]):
        return

    target = await updater_client.get_target()
    if not target:
        return
    managed, _ = is_managed(
        target, VERSION, app_settings.homst_self_update_disabled
    )
    if not managed:
        return

    # Force the release feed here: the card can use its normal cache, but the
    # background check should actually hit GitHub at the configured interval.
    feed = await fetch_releases(force=True)
    latest = feed.latest
    if not latest:
        return
    if not is_newer(VERSION, latest["version"]):
        return

    status = await updater_client.get_status() or {}
    if (status.get("job") or {}).get("state") in ACTIVE_JOB_STATES:
        return
    if status.get("held_version") == latest["version"]:
        return
    if household_settings.get("updateDismissedVersion") == latest["version"]:
        return

    try:
        await publish_event(
            DEFAULT_HOUSEHOLD_ID,
            "system.update.available",
            {
                "version": latest["version"],
                "current": VERSION,
                "major": is_major_update(VERSION, latest["version"]),
                "html_url": latest.get("html_url"),
            },
        )
    except Exception:
        pass

    print(
        f"[worker] update available: {latest['version']} "
        f"(current {VERSION}); waiting for display confirmation"
    )


async def apply_auto_theme(ctx, now=None):
    """Flip every client's appearance at sunrise and sunset.

    ``theme`` stays ``auto`` in the household settings; only the resolved
    ``autoThemeDark`` flag is persisted and pushed over the normal
    ``settings.updated`` event. Clients therefore never need to know the
    household's coordinates or run their own solar clock.
    """
    async with async_session() as session:
        result = await session.execute(
            select(Household).where(Household.id == DEFAULT_HOUSEHOLD_ID)
        )
        household = result.scalar_one_or_none()
        if household is None:
            return

        current = dict(household.settings or {})
        state = auto_theme_state(current, now=now)
        if not state:
            return
        if current.get("autoThemeDark") == state["autoThemeDark"]:
            return

        merged = {**current, "autoThemeDark": state["autoThemeDark"]}
        household.settings = merged
        await session.commit()

    try:
        await publish_event(
            DEFAULT_HOUSEHOLD_ID,
            "settings.updated",
            {"settings": {**merged, **state}},
        )
    except Exception:
        pass
    print(f"[worker] auto theme → {'dark' if state['autoThemeDark'] else 'light'}")


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
        apply_auto_theme,
    ]
    cron_jobs = [
        # Reminder scan: runs at second 0 of every minute.
        cron(dispatch_reminders),
        # Sunrise/sunset appearance flips; only publishes on a real change.
        cron(apply_auto_theme),
        # Update availability check; the configured interval is enforced in code.
        cron(check_auto_update),
        # cron(sync_all_external_calendars, hour={*range(24)}, minute={0, 15, 30, 45})
    ]
    redis_settings = RedisSettings.from_dsn(app_settings.redis_url)
    on_startup = startup
    on_shutdown = shutdown
