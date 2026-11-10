"""Read Nest thermostat and temperature-sensor readings.

Google's official SDM API only exposes the thermostat's ambient temperature,
not the individual Nest Temperature Sensors. This module uses the same
unofficial Nest web API that the Nest app (and Home Assistant's "Nest Legacy"
integration) uses, so every sensor shows up as its own room.

Credentials are pasted once in Settings. For Google accounts that means the
``issueToken`` URL and ``cookies`` header copied from a signed-in
``home.nest.com`` session; Google rotates some cookies on each token request,
so the rotated values are written back to the database.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.all import ServerSetting

NEST_HOST = "home.nest.com"
NEST_JWT_URL = "https://nestauthproxyservice-pa.googleapis.com/v1/issue_jwt"
NEST_APP_LAUNCH_URL = f"https://{NEST_HOST}/api/0.1/user/{{user_id}}/app_launch"
NEST_SESSION_URL = f"https://{NEST_HOST}/session"
NEST_USER_AGENT = "Nest/5.87.0 (iOScom.nestlabs.jasper.release) os=26.4"

# Only the buckets needed for temperatures; app_launch returns just these.
NEST_BUCKET_TYPES = [
    "device",
    "shared",
    "track",
    "where",
    "kryptonite",
    "rcs_settings",
    "link",
    "structure",
]

SETTING_AUTH_TYPE = "nest_auth_type"
SETTING_ISSUE_TOKEN = "nest_issue_token"
SETTING_COOKIES = "nest_cookies"
SETTING_ACCESS_TOKEN = "nest_access_token"
CREDENTIAL_KEYS = (
    SETTING_AUTH_TYPE,
    SETTING_ISSUE_TOKEN,
    SETTING_COOKIES,
    SETTING_ACCESS_TOKEN,
)

CACHE_TTL_SECONDS = 60
ERROR_CACHE_TTL_SECONDS = 20
SESSION_FALLBACK_SECONDS = 60 * 60
SENSOR_OFFLINE_AFTER_SECONDS = 4 * 60 * 60

_AUTH_ERROR = (
    "Nest sign-in expired. Open Settings → Indoor temperatures and paste fresh credentials."
)
_SERVICE_ERROR = "Could not reach Nest. It will retry automatically."


class NestError(Exception):
    """Base class for Nest integration failures."""


class NestAuthError(NestError):
    """The stored credentials are missing, expired or rejected."""


class NestServiceError(NestError):
    """Nest answered with a transient/service error."""


@dataclass
class _Cache:
    data: dict[str, Any] | None = None
    expires_at: float = 0.0
    lock: asyncio.Lock = asyncio.Lock()


_cache = _Cache()
_session: dict[str, Any] | None = None
_session_expires_at = 0.0


def reset_nest_cache() -> None:
    """Forget cached readings and the in-memory Nest session."""
    global _session, _session_expires_at
    _cache.data = None
    _cache.expires_at = 0.0
    _session = None
    _session_expires_at = 0.0


def _new_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(20.0), follow_redirects=True)


def _unwrap(value: str) -> str:
    """Undo the line wrapping that pasting a long browser value can add."""
    return "".join(value.splitlines()).strip()


def _normalize_cookies(cookies: str) -> str:
    cookies = _unwrap(cookies)
    if cookies.lower().startswith("cookie:"):
        cookies = cookies.split(":", 1)[1].strip()
    return cookies


def _validate_google_credentials(issue_token: str, cookies: str) -> None:
    parts = urlsplit(issue_token)
    if (
        parts.scheme != "https"
        or parts.hostname != "accounts.google.com"
        or not parts.path.startswith("/o/oauth2/iframerpc")
    ):
        raise NestAuthError(
            "The issue token must be the iframerpc request URL copied from home.nest.com."
        )
    if "action=issueToken" not in issue_token:
        raise NestAuthError(
            "The issue token URL is missing action=issueToken. Copy the whole "
            "iframerpc request URL."
        )
    names = {pair.partition("=")[0].strip() for pair in cookies.split(";") if pair.strip()}
    if not names.intersection({"SID", "__Secure-1PSID", "__Secure-3PSID"}):
        raise NestAuthError(
            "The cookies value is missing a Google session cookie (SID or "
            "__Secure-1PSID). Copy the Cookie request header."
        )


def _is_expired_cookie(attributes: list[str]) -> bool:
    max_age: str | None = None
    expires: str | None = None
    for attribute in attributes:
        key, _, value = attribute.strip().partition("=")
        key = key.lower()
        if key == "max-age":
            max_age = value.strip()
        elif key == "expires":
            expires = value.strip()
    if max_age is not None:
        try:
            return int(max_age) <= 0
        except ValueError:
            return False
    if expires:
        try:
            return parsedate_to_datetime(expires) <= datetime.now(timezone.utc)
        except (TypeError, ValueError):
            return False
    return False


def merge_cookies(cookies: str, set_cookie_headers: list[str]) -> str:
    """Apply Google's rotated Set-Cookie values to a copied cookie header."""
    jar: dict[str, str] = {}
    for pair in cookies.split(";"):
        name, _, value = pair.strip().partition("=")
        if name:
            jar[name] = value

    changed = False
    for header in set_cookie_headers:
        parts = header.split(";")
        name, _, value = parts[0].strip().partition("=")
        if not name:
            continue
        if _is_expired_cookie(parts[1:]):
            if jar.pop(name, None) is not None:
                changed = True
        elif jar.get(name) != value:
            jar[name] = value
            changed = True

    if not changed:
        return cookies
    return "; ".join(f"{name}={value}" for name, value in jar.items())


async def _request_json(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    **kwargs: Any,
) -> tuple[dict[str, Any], httpx.Response]:
    """Make a request and turn HTTP failures into Nest errors."""
    try:
        response = await client.request(method, url, headers=headers, **kwargs)
    except httpx.HTTPError as exc:
        raise NestServiceError(_SERVICE_ERROR) from exc

    if response.status_code in (401, 403):
        raise NestAuthError(_AUTH_ERROR)
    if response.status_code >= 500 or response.status_code in (408, 429):
        raise NestServiceError(_SERVICE_ERROR)
    if not response.is_success:
        raise NestAuthError(_AUTH_ERROR)
    try:
        data = response.json()
    except ValueError as exc:
        raise NestServiceError(_SERVICE_ERROR) from exc
    if not isinstance(data, dict):
        raise NestServiceError(_SERVICE_ERROR)
    return data, response


async def _get_google_access_token(
    client: httpx.AsyncClient,
    issue_token: str,
    cookies: str,
) -> tuple[str, str]:
    """Exchange copied Google cookies for an OAuth access token."""
    data, response = await _request_json(
        client,
        "GET",
        issue_token,
        headers={
            "Sec-Fetch-Mode": "cors",
            "User-Agent": NEST_USER_AGENT,
            "X-Requested-With": "XmlHttpRequest",
            "Referer": "https://accounts.google.com/o/oauth2/iframe",
            "cookie": cookies,
        },
    )
    rotated = merge_cookies(cookies, response.headers.get_list("set-cookie"))
    token = data.get("access_token")
    if not token:
        raise NestAuthError(_AUTH_ERROR)
    return token, rotated


async def _get_nest_jwt(client: httpx.AsyncClient, google_token: str) -> str:
    """Exchange a Google OAuth token for a Nest session JWT."""
    data, _ = await _request_json(
        client,
        "POST",
        NEST_JWT_URL,
        headers={
            "Authorization": f"Bearer {google_token}",
            "User-Agent": NEST_USER_AGENT,
            "Referer": f"https://{NEST_HOST}",
        },
        data={
            "embed_google_oauth_access_token": "true",
            "expire_after": "3600s",
            "google_oauth_access_token": google_token,
            "policy_id": "authproxy-oauth-policy",
        },
    )
    jwt = data.get("jwt")
    if not jwt:
        raise NestAuthError(_AUTH_ERROR)
    return jwt


def _session_expiry(expires_in: Any) -> float:
    if isinstance(expires_in, str):
        try:
            return parsedate_to_datetime(expires_in.removesuffix(" GMT")).timestamp()
        except (TypeError, ValueError):
            pass
    return time.time() + SESSION_FALLBACK_SECONDS


async def _get_session(client: httpx.AsyncClient, token: str) -> dict[str, Any]:
    """Load the Nest session (user id, transport URL and expiry)."""
    data, _ = await _request_json(
        client,
        "GET",
        NEST_SESSION_URL,
        headers={"Authorization": f"Basic {token}", "User-Agent": NEST_USER_AGENT},
    )
    access_token = data.get("access_token")
    userid = data.get("userid") or data.get("user")
    if not access_token or not userid:
        raise NestAuthError(_AUTH_ERROR)
    return {
        "access_token": access_token,
        "userid": userid,
        "email": data.get("email"),
        "expires_at": _session_expiry(data.get("expires_in")),
    }


async def _get_nest_session(
    client: httpx.AsyncClient,
    creds: dict[str, str],
    db: AsyncSession,
) -> dict[str, Any]:
    global _session, _session_expires_at

    if _session and time.time() < _session_expires_at:
        return _session

    if creds["type"] == "google":
        google_token, rotated = await _get_google_access_token(
            client, creds["issue_token"], creds["cookies"]
        )
        if rotated != creds["cookies"]:
            await _save_setting(db, SETTING_COOKIES, rotated)
            creds["cookies"] = rotated
        token = await _get_nest_jwt(client, google_token)
    else:
        token = creds["access_token"]

    _session = await _get_session(client, token)
    _session_expires_at = _session["expires_at"]
    return _session


async def _app_launch(client: httpx.AsyncClient, session: dict[str, Any]) -> list[dict[str, Any]]:
    """Fetch every bucket we need for temperatures in one request."""
    data, _ = await _request_json(
        client,
        "POST",
        NEST_APP_LAUNCH_URL.format(user_id=session["userid"]),
        headers={
            "Authorization": f"Basic {session['access_token']}",
            "X-nl-user-id": session["userid"],
            "X-nl-protocol-version": "1",
            "User-Agent": NEST_USER_AGENT,
        },
        json={"known_bucket_types": NEST_BUCKET_TYPES, "known_bucket_versions": []},
    )
    if data.get("error"):
        raise NestServiceError(_SERVICE_ERROR)
    buckets = data.get("updated_buckets")
    if not isinstance(buckets, list):
        raise NestServiceError(_SERVICE_ERROR)
    return buckets


def _where_names(buckets: list[dict[str, Any]]) -> dict[str, str]:
    names: dict[str, str] = {}
    for bucket in buckets:
        if not str(bucket.get("object_key", "")).startswith("where."):
            continue
        value = bucket.get("value") or {}
        for where in value.get("wheres", []):
            where_id = where.get("where_id")
            name = where.get("name")
            if where_id and name:
                names[where_id] = str(name).strip()
    return names


def _bucket_values(buckets: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    values: dict[str, dict[str, Any]] = {}
    for bucket in buckets:
        key = bucket.get("object_key")
        value = bucket.get("value")
        if isinstance(key, str) and isinstance(value, dict):
            values[key] = value
    return values


def _location(data: dict[str, Any], wheres: dict[str, str]) -> str | None:
    where_id = data.get("where_id")
    return wheres.get(where_id) if where_id else None


def _active_sensors(values: dict[str, dict[str, Any]]) -> set[str]:
    active: set[str] = set()
    for key, value in values.items():
        if key.startswith("rcs_settings."):
            for sensor in value.get("active_rcs_sensors", []) or []:
                active.add(str(sensor))
    return active


def _temperature(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_rooms(buckets: list[dict[str, Any]], now: float | None = None) -> list[dict[str, Any]]:
    """Turn app_launch buckets into one row per thermostat and sensor."""
    values = _bucket_values(buckets)
    wheres = _where_names(buckets)
    active = _active_sensors(values)
    now = time.time() if now is None else now
    rooms: list[dict[str, Any]] = []

    for key, value in values.items():
        if key.startswith("device."):
            device_id = key.split(".", 1)[1]
            shared = values.get(f"shared.{device_id}", {})
            data = {**value, **shared}
            temperature = _temperature(data.get("current_temperature"))
            if temperature is None:
                continue
            room = _location(data, wheres)
            name = data.get("description") or room or "Thermostat"
            humidity = data.get("current_humidity")
            rooms.append(
                {
                    "id": key,
                    "name": str(name),
                    "room": room,
                    "temperatureC": temperature,
                    "humidity": round(humidity) if isinstance(humidity, (int, float)) else None,
                    "kind": "thermostat",
                    "online": bool(values.get(f"track.{device_id}", {}).get("online", True)),
                    "active": False,
                }
            )
        elif key.startswith("kryptonite."):
            temperature = _temperature(value.get("current_temperature"))
            if temperature is None:
                continue
            room = _location(value, wheres)
            name = value.get("description") or room or "Temperature Sensor"
            last_updated = value.get("last_updated_at")
            online = (
                not isinstance(last_updated, (int, float))
                or now - last_updated < SENSOR_OFFLINE_AFTER_SECONDS
            )
            rooms.append(
                {
                    "id": key,
                    "name": str(name),
                    "room": room,
                    "temperatureC": temperature,
                    "humidity": None,
                    "kind": "sensor",
                    "online": online,
                    "active": key in active,
                }
            )

    rooms.sort(key=lambda room: (room["kind"] != "thermostat", room["room"] or room["name"]))
    return rooms


async def _load_credentials(db: AsyncSession) -> dict[str, str] | None:
    result = await db.execute(select(ServerSetting).where(ServerSetting.key.in_(CREDENTIAL_KEYS)))
    values = {row.key: row.value for row in result.scalars()}
    auth_type = values.get(SETTING_AUTH_TYPE)
    if auth_type == "google" and values.get(SETTING_ISSUE_TOKEN) and values.get(SETTING_COOKIES):
        return {
            "type": "google",
            "issue_token": values[SETTING_ISSUE_TOKEN],
            "cookies": values[SETTING_COOKIES],
        }
    if auth_type == "nest" and values.get(SETTING_ACCESS_TOKEN):
        return {"type": "nest", "access_token": values[SETTING_ACCESS_TOKEN]}
    return None


async def _save_setting(db: AsyncSession, key: str, value: str) -> None:
    row = await db.get(ServerSetting, key)
    if row:
        row.value = value
    else:
        db.add(ServerSetting(key=key, value=value))
    await db.commit()


async def save_credentials(
    db: AsyncSession,
    *,
    account_type: str,
    issue_token: str | None = None,
    cookies: str | None = None,
    access_token: str | None = None,
) -> None:
    """Store credentials, replacing whatever was configured before."""
    if account_type == "google":
        issue_token = _unwrap(issue_token or "")
        cookies = _normalize_cookies(cookies or "")
        _validate_google_credentials(issue_token, cookies)
        values = {
            SETTING_AUTH_TYPE: "google",
            SETTING_ISSUE_TOKEN: issue_token,
            SETTING_COOKIES: cookies,
            SETTING_ACCESS_TOKEN: "",
        }
    elif account_type == "nest":
        access_token = _unwrap(access_token or "")
        if not access_token:
            raise NestAuthError("Paste a Nest access token.")
        values = {
            SETTING_AUTH_TYPE: "nest",
            SETTING_ISSUE_TOKEN: "",
            SETTING_COOKIES: "",
            SETTING_ACCESS_TOKEN: access_token,
        }
    else:
        raise NestAuthError("Choose a Google or Nest account.")

    for key, value in values.items():
        await _save_setting(db, key, value)
    reset_nest_cache()


async def clear_credentials(db: AsyncSession) -> None:
    result = await db.execute(select(ServerSetting).where(ServerSetting.key.in_(CREDENTIAL_KEYS)))
    for row in result.scalars():
        await db.delete(row)
    await db.commit()
    reset_nest_cache()


async def _fetch_rooms(
    db: AsyncSession,
    creds: dict[str, str],
    client: httpx.AsyncClient,
) -> list[dict[str, Any]]:
    global _session, _session_expires_at

    session = await _get_nest_session(client, creds, db)
    try:
        buckets = await _app_launch(client, session)
    except NestAuthError:
        # The session can go stale before its advertised expiry. Re-auth once.
        _session = None
        _session_expires_at = 0.0
        session = await _get_nest_session(client, creds, db)
        buckets = await _app_launch(client, session)
    return parse_rooms(buckets)


def _empty_status(*, configured: bool, auth_type: str | None = None) -> dict[str, Any]:
    return {
        "configured": configured,
        "authType": auth_type,
        "connected": False,
        "rooms": [],
        "updatedAt": None,
        "error": None if not configured else _AUTH_ERROR,
    }


async def get_temperatures(
    db: AsyncSession,
    *,
    force: bool = False,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Return cached room readings, refreshing from Nest at most once a minute."""
    if not force and _cache.data is not None and time.time() < _cache.expires_at:
        return _cache.data

    async with _cache.lock:
        creds = await _load_credentials(db)
        if creds is None:
            data = _empty_status(configured=False)
            _cache.data = data
            _cache.expires_at = time.time() + ERROR_CACHE_TTL_SECONDS
            return data

        previous = _cache.data
        owned_client = client is None
        active_client = _new_client() if owned_client else client
        try:
            rooms = await _fetch_rooms(db, creds, active_client)
            data = {
                "configured": True,
                "authType": creds["type"],
                "connected": True,
                "rooms": rooms,
                "updatedAt": datetime.now(timezone.utc).isoformat(),
                "error": None,
            }
            _cache.expires_at = time.time() + CACHE_TTL_SECONDS
        except NestAuthError as exc:
            data = {
                "configured": True,
                "authType": creds["type"],
                "connected": False,
                "rooms": previous["rooms"] if previous else [],
                "updatedAt": previous["updatedAt"] if previous else None,
                "error": str(exc),
            }
            _cache.expires_at = time.time() + ERROR_CACHE_TTL_SECONDS
        except NestServiceError as exc:
            data = {
                "configured": True,
                "authType": creds["type"],
                "connected": False,
                "rooms": previous["rooms"] if previous else [],
                "updatedAt": previous["updatedAt"] if previous else None,
                "error": str(exc),
            }
            _cache.expires_at = time.time() + ERROR_CACHE_TTL_SECONDS
        except Exception:
            data = {
                "configured": True,
                "authType": creds["type"],
                "connected": False,
                "rooms": previous["rooms"] if previous else [],
                "updatedAt": previous["updatedAt"] if previous else None,
                "error": _SERVICE_ERROR,
            }
            _cache.expires_at = time.time() + ERROR_CACHE_TTL_SECONDS
        finally:
            if owned_client:
                await active_client.aclose()

        _cache.data = data
        return data
