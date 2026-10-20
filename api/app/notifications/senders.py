"""Outbound notification senders: Web Push message formatting and HUD fan-out.

All senders are best-effort and return ``(ok, detail)`` instead of raising —
a failed delivery must never crash the reminders worker.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from app.events.publisher import publish_event

# ── Formatting helpers ────────────────────────────────────────────────


def format_lead(minutes: int) -> str:
    """Human phrase for a reminder offset: '30 min', '1 hour', '1 day'."""
    if minutes % 1440 == 0:
        days = minutes // 1440
        return "1 day" if days == 1 else f"{days} days"
    if minutes % 60 == 0:
        hours = minutes // 60
        return "1 hour" if hours == 1 else f"{hours} hours"
    return f"{minutes} min"


def _household_tz(tz_name: str | None):
    """Timezone for formatting; falls back to UTC if the tz database lacks it."""
    from datetime import timezone as _timezone
    from zoneinfo import ZoneInfo

    try:
        return ZoneInfo(tz_name) if tz_name else _timezone.utc
    except Exception:
        return _timezone.utc


def format_start(
    start_at: datetime, tz_name: str | None = None, now: datetime | None = None
) -> str:
    """Format an event start for humans, in the household's timezone."""
    tz = _household_tz(tz_name)
    local = start_at.astimezone(tz)
    label = local.strftime("%I:%M %p").lstrip("0")

    if now is not None:
        local_now = now.astimezone(tz)
        if local.date() == local_now.date():
            return f"today at {label}"
        if local.date() == (local_now + timedelta(days=1)).date():
            return f"tomorrow at {label}"

    return f"{local.strftime('%a, %b %d')} at {label}"


def push_message(
    title: str,
    start_at: datetime,
    minutes_before: int,
    *,
    all_day: bool = False,
    tz_name: str | None = None,
    now: datetime | None = None,
) -> tuple[str, str]:
    """Build (title, body) for a short push notification."""
    when = "All day" if all_day else format_start(start_at, tz_name, now)
    if minutes_before <= 0:
        lead = "starting now"
    else:
        lead = f"in {format_lead(minutes_before)}"
    return f"Reminder: {title}", f"{when} · {lead}"


# ── HUD (in-app heads-up display over SSE) ────────────────────────────


async def publish_hud_reminder(household_id: str, payload: dict) -> tuple[bool, str]:
    """Fan a reminder out over the SSE stream so the wall display shows it."""
    try:
        await publish_event(household_id, "reminder.due", payload)
        return True, "published"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"
