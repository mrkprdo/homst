"""Sunrise/sunset scheduling for the automatic appearance theme.

The server owns the day/night decision so every client switches together. The
worker publishes a ``settings.updated`` event when the sun crosses the horizon;
readers get the same resolved state from ``GET /household/settings`` when they
(re)connect, so nothing depends on each client tracking the sun itself.
"""

import math
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

# Upper limb of the sun at the horizon, including refraction.
DARK_ELEVATION = -0.833

# One scan step for finding sunrise/sunset transitions.
_SCAN_STEP = timedelta(minutes=1)


def _resolve_tz(name: str | None) -> ZoneInfo:
    """Return a usable timezone, falling back to UTC for missing/bad values."""
    try:
        return ZoneInfo(name) if name else ZoneInfo("UTC")
    except Exception:
        return ZoneInfo("UTC")


def solar_elevation(lat: float, lon: float, when: datetime) -> float:
    """Approximate solar elevation in degrees at a UTC instant.

    Uses the NOAA solar-position equations. Accurate to a few tenths of a
    degree for appearance scheduling.
    """
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    when = when.astimezone(timezone.utc)

    day_of_year = when.timetuple().tm_yday
    minutes = when.hour * 60 + when.minute + when.second / 60 + when.microsecond / 60_000_000
    gamma = 2 * math.pi / 365.0 * (day_of_year - 1 + (minutes / 60.0 - 12) / 24.0)

    eqtime = 229.18 * (
        0.000075
        + 0.001868 * math.cos(gamma)
        - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma)
        - 0.040849 * math.sin(2 * gamma)
    )
    declination = (
        0.006918
        - 0.399912 * math.cos(gamma)
        + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma)
        + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma)
        + 0.00148 * math.sin(3 * gamma)
    )

    # True solar time (minutes) and hour angle (degrees).
    true_solar_time = (minutes + eqtime + 4.0 * lon) % 1440.0
    hour_angle = math.radians(true_solar_time / 4.0 - 180.0)

    lat_rad = math.radians(lat)
    cos_zenith = (
        math.sin(lat_rad) * math.sin(declination)
        + math.cos(lat_rad) * math.cos(declination) * math.cos(hour_angle)
    )
    return math.degrees(math.asin(max(-1.0, min(1.0, cos_zenith))))


def is_dark(lat: float, lon: float, when: datetime | None = None) -> bool:
    """True when the sun is below the horizon at the given instant."""
    return solar_elevation(lat, lon, when or datetime.now(timezone.utc)) < DARK_ELEVATION


@lru_cache(maxsize=64)
def _sun_times(
    lat: float, lon: float, tz_name: str, day: date
) -> tuple[datetime | None, datetime | None]:
    tz = _resolve_tz(tz_name)
    start = datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)

    # Walk the local day so DST changes and odd offsets need no special cases.
    # A 1-minute step is enough for a schedule that flips on the minute.
    previous_dark = is_dark(lat, lon, start)
    sunrise: datetime | None = None
    sunset: datetime | None = None
    current = start + _SCAN_STEP
    while current <= end:
        dark = is_dark(lat, lon, current)
        if previous_dark and not dark and sunrise is None:
            sunrise = current
        elif not previous_dark and dark and sunset is None:
            sunset = current
        previous_dark = dark
        current += _SCAN_STEP

    # Return in the household's local timezone so clients can format directly.
    return (
        sunrise.astimezone(tz) if sunrise else None,
        sunset.astimezone(tz) if sunset else None,
    )


def _coordinate(value: object, limit: float) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or abs(number) > limit:
        return None
    return number


def auto_theme_state(settings: dict, now: datetime | None = None) -> dict:
    """Resolve an ``auto`` theme to its current day/night state.

    Returns an empty dict when the theme is not ``auto`` or the household has
    no usable coordinates. The resolved keys are ephemeral: ``autoThemeDark``
    is persisted by the router/worker, while the sunrise/sunset times are only
    attached to responses and broadcasts.
    """
    if settings.get("theme") != "auto":
        return {}

    lat = _coordinate(settings.get("lat"), 90)
    lon = _coordinate(settings.get("lon"), 180)
    if lat is None or lon is None:
        return {}

    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    tz = _resolve_tz(settings.get("timezone"))
    day = moment.astimezone(tz).date()
    sunrise, sunset = _sun_times(lat, lon, tz.key, day)

    state: dict = {"autoThemeDark": solar_elevation(lat, lon, moment) < DARK_ELEVATION}
    if sunrise is not None:
        state["autoSunrise"] = sunrise.isoformat()
    if sunset is not None:
        state["autoSunset"] = sunset.isoformat()
    return state
