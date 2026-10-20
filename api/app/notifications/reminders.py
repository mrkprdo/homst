"""Reminder detection and dispatch.

A worker cron job runs once a minute and calls :func:`dispatch_due_reminders`.
For every event with ``reminder_minutes`` set whose due time has arrived, the
reminder is fanned out to the enabled channels:

- ``hud``   — published over the household SSE stream (sent since minute one)
- ``push``  — Web Push to every device with a live subscription

Delivery is idempotent: every (event occurrence, channel) pair is recorded in
``reminder_log`` with a unique constraint, so restarts, retries or overlapping
ticks can never double-send.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.all import Calendar, Event, ReminderLog
from app.notifications.push import (
    deliver_push,
    get_vapid_keys,
    push_payload,
    subscriptions_for,
    vapid_subject,
)
from app.notifications.senders import (
    format_start,
    publish_hud_reminder,
    push_message,
)

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"

# A reminder due just before a worker tick is still delivered after it; this is
# also the tolerance for short worker restarts.
CATCHUP = timedelta(minutes=6)

# Upper bound for how far ahead an event may start and still be considered.
MAX_LEAD = timedelta(days=8)


def _as_utc(dt: datetime) -> datetime:
    """Normalize DB datetimes (SQLite returns naive) for comparison."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _add_months(dt: datetime, months: int) -> datetime:
    """Add months with day clamping (Jan 31 + 1 month = Feb 28/29)."""
    month_index = dt.month - 1 + months
    year = dt.year + month_index // 12
    month = month_index % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def _step(dt: datetime, freq: str) -> datetime | None:
    if freq == "daily":
        return dt + timedelta(days=1)
    if freq == "weekly":
        return dt + timedelta(days=7)
    if freq == "biweekly":
        return dt + timedelta(days=14)
    if freq == "monthly":
        return _add_months(dt, 1)
    if freq == "yearly":
        return _add_months(dt, 12)
    return None


def occurrences_between(ev: Event, from_dt: datetime, to_dt: datetime) -> list[datetime]:
    """Occurrence start times of ``ev`` inside ``[from_dt, to_dt]``.

    Mirrors the frontend's recurrence expansion (daily / weekly / biweekly /
    monthly / yearly with ``until`` / ``count``) but only for the narrow
    reminder window, so recurring events remind for every occurrence.
    """
    start = _as_utc(ev.start_at)
    rec = ev.recurrence or {}
    freq = rec.get("freq")
    if not freq:
        return [start] if from_dt <= start <= to_dt else []

    until = rec.get("until")
    end_bound = _as_utc(datetime.fromisoformat(until.replace("Z", "+00:00"))) if until else to_dt
    end_bound = min(end_bound, to_dt)
    max_count = int(rec.get("count") or 730)

    cursor = start
    n = 0

    # Fast-forward fixed-step frequencies so long histories don't iterate.
    if cursor < from_dt:
        step = {
            "daily": timedelta(days=1),
            "weekly": timedelta(days=7),
            "biweekly": timedelta(days=14),
        }.get(freq)
        if step:
            skip = max(0, int((from_dt - cursor) / step) - 1)
            cursor += skip * step
            n = skip

    occurrences: list[datetime] = []
    while cursor <= end_bound and n < max_count and len(occurrences) < 400:
        if cursor >= from_dt:
            occurrences.append(cursor)
        nxt = _step(cursor, freq)
        if nxt is None or nxt <= cursor:
            break
        cursor = nxt
        n += 1
    return occurrences


@dataclass
class DueReminder:
    event: Event
    occurrence_at: datetime
    minutes_before: int


async def find_due_reminders(session: AsyncSession, now: datetime) -> list[DueReminder]:
    """All (event, occurrence) pairs whose reminder is due as of ``now``."""
    cal_ids = (await session.execute(
        select(Calendar.id).where(Calendar.household_id == DEFAULT_HOUSEHOLD_ID)
    )).scalars().all()
    if not cal_ids:
        return []

    events = (await session.execute(
        select(Event).where(
            Event.calendar_id.in_(cal_ids),
            Event.source == "internal",
            Event.reminder_minutes.isnot(None),
            Event.start_at <= now + MAX_LEAD,
        )
    )).scalars().all()

    due: list[DueReminder] = []
    for ev in events:
        minutes = int(ev.reminder_minutes or 0)
        offset = timedelta(minutes=minutes)
        # Occurrences whose due time falls in (now - CATCHUP, now].
        occs = occurrences_between(ev, now - CATCHUP + offset, now + offset)
        for occ in occs:
            if now - CATCHUP < occ - offset <= now:
                due.append(DueReminder(event=ev, occurrence_at=occ, minutes_before=minutes))
    return due


def channel_flags(household_settings: dict | None) -> dict[str, bool]:
    """Which channels the household has enabled.

    HUD is on by default (it costs nothing and needs no setup); Web Push is
    on by default too and fans out to every subscribed device.
    """
    n = (household_settings or {}).get("notifications") or {}
    return {
        "hud": n.get("hud", True) is not False,
        "push": n.get("push", True) is not False,
    }


def _add_log(
    session: AsyncSession,
    ev: Event,
    occurrence_at: datetime,
    channel: str,
    status: str,
    detail: str | None,
    now: datetime,
) -> ReminderLog:
    log = ReminderLog(
        event_id=ev.id,
        occurrence_at=occurrence_at,
        channel=channel,
        status=status,
        detail=detail,
        sent_at=now,
    )
    session.add(log)
    return log


async def _dispatch_one(
    session: AsyncSession,
    due: DueReminder,
    now: datetime,
    flags: dict[str, bool],
    tz_name: str | None,
    deliver_hud,
) -> list[ReminderLog]:
    ev = due.event
    occ = due.occurrence_at

    already = {
        log.channel
        for log in (await session.execute(
            select(ReminderLog).where(ReminderLog.event_id == ev.id)
        )).scalars().all()
        if _as_utc(log.occurrence_at) == occ
    }

    logs: list[ReminderLog] = []

    if flags["hud"] and "hud" not in already:
        ok, detail = await deliver_hud(DEFAULT_HOUSEHOLD_ID, {
            "event_id": ev.id,
            "calendar_id": ev.calendar_id,
            "title": ev.title,
            "start_at": occ.isoformat(),
            "minutes_before": due.minutes_before,
            "all_day": bool(ev.all_day),
        })
        logs.append(_add_log(session, ev, occ, "hud", "sent" if ok else "failed", detail, now))

    if flags["push"] and "push" not in already:
        subscriptions = await subscriptions_for(session, DEFAULT_HOUSEHOLD_ID)
        if subscriptions:
            push_title, push_body = push_message(
                ev.title, occ, due.minutes_before,
                all_day=bool(ev.all_day), tz_name=tz_name, now=now,
            )
            _, private_key = await get_vapid_keys(session)
            ok, detail = await deliver_push(
                session,
                subscriptions,
                push_payload(
                    push_title, push_body,
                    event_id=ev.id,
                    start_at=occ,
                    minutes_before=due.minutes_before,
                    all_day=bool(ev.all_day),
                ),
                private_key=private_key,
                subject=vapid_subject(),
            )
            logs.append(_add_log(session, ev, occ, "push", "sent" if ok else "failed", detail, now))

    return logs


async def dispatch_due_reminders(
    session: AsyncSession,
    now: datetime | None = None,
    *,
    deliver_hud=publish_hud_reminder,
) -> list[ReminderLog]:
    """Send every reminder that has come due; record what was delivered."""
    from app.models.all import Household

    now = _as_utc(now or datetime.now(timezone.utc))

    household = (await session.execute(
        select(Household).where(Household.id == DEFAULT_HOUSEHOLD_ID)
    )).scalar_one_or_none()
    household_settings = (household.settings if household else {}) or {}
    flags = channel_flags(household_settings)
    tz_name = household_settings.get("timezone")

    due = await find_due_reminders(session, now)

    logs: list[ReminderLog] = []
    for item in due:
        try:
            logs.extend(await _dispatch_one(
                session, item, now, flags, tz_name, deliver_hud,
            ))
            await session.commit()
        except IntegrityError:
            # Another tick already logged this occurrence — nothing to do.
            await session.rollback()
    return logs


# ── Ad-hoc test notification (settings panel) ─────────────────────────


async def send_test_notification(
    *,
    channels: list[str] | None = None,
    session: AsyncSession | None = None,
    deliver_hud=publish_hud_reminder,
    now: datetime | None = None,
) -> dict[str, str]:
    """Push a test reminder through the requested channels, reporting each."""
    wanted = channels or ["hud", "push"]
    now = _as_utc(now or datetime.now(timezone.utc))
    when = format_start(now + timedelta(minutes=30), None, now)

    results: dict[str, str] = {}

    if "hud" in wanted:
        ok, detail = await deliver_hud(DEFAULT_HOUSEHOLD_ID, {
            "event_id": "test",
            "calendar_id": None,
            "title": "Test reminder",
            "start_at": (now + timedelta(minutes=30)).isoformat(),
            "minutes_before": 30,
            "all_day": False,
            "test": True,
        })
        results["hud"] = "sent to the display" if ok else f"failed: {detail}"

    if "push" in wanted:
        if session is None:
            results["push"] = "skipped: no database session"
        else:
            subscriptions = await subscriptions_for(session, DEFAULT_HOUSEHOLD_ID)
            if not subscriptions:
                results["push"] = "skipped: no devices have push turned on"
            else:
                _, private_key = await get_vapid_keys(session)
                ok, detail = await deliver_push(
                    session,
                    subscriptions,
                    push_payload(
                        "Test reminder",
                        f"A real reminder looks like: an event {when}.",
                        start_at=now + timedelta(minutes=30),
                        minutes_before=30,
                    ),
                    private_key=private_key,
                    subject=vapid_subject(),
                )
                results["push"] = (
                    f"sent to {len(subscriptions)} device(s)" if ok else f"failed: {detail}"
                )

    return results
