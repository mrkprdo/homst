from __future__ import annotations

import time

import httpx
import pytest
from sqlalchemy import select

from app import nest
from app.models.all import ServerSetting
from app.nest import (
    NestAuthError,
    NestServiceError,
    clear_credentials,
    get_temperatures,
    merge_cookies,
    parse_rooms,
    reset_nest_cache,
    save_credentials,
)

ISSUE_TOKEN = "https://accounts.google.com/o/oauth2/iframerpc?action=issueToken&x=1"
COOKIES = "SID=abc; HSID=def; SSID=ghi"

BUCKETS = [
    {
        "object_key": "where.structure",
        "value": {
            "wheres": [
                {"where_id": "living", "name": "Living Room"},
                {"where_id": "kids", "name": " Kids Room "},
            ]
        },
    },
    {
        "object_key": "device.thermo",
        "value": {
            "description": "Living Room",
            "where_id": "living",
            "serial_number": "T1",
        },
    },
    {
        "object_key": "shared.thermo",
        "value": {
            "current_temperature": 21.5,
            "current_humidity": 44.6,
            "temperature_scale": "C",
        },
    },
    {"object_key": "track.thermo", "value": {"online": True}},
    {
        "object_key": "kryptonite.basement",
        "value": {
            "description": "Basement",
            "where_id": "kids",
            "current_temperature": 18.25,
            "last_updated_at": time.time(),
        },
    },
    {
        "object_key": "kryptonite.old",
        "value": {
            "description": "Old",
            "current_temperature": 10,
            "last_updated_at": 0,
        },
    },
    {
        "object_key": "rcs_settings.thermo",
        "value": {"active_rcs_sensors": ["kryptonite.basement"]},
    },
    {"object_key": "ignored", "value": "not a dict"},
]


@pytest.fixture(autouse=True)
def _clean_cache():
    reset_nest_cache()
    yield
    reset_nest_cache()


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _app_launch_response(buckets=BUCKETS) -> httpx.Response:
    return httpx.Response(200, json={"updated_buckets": buckets})


async def _google_handler(request: httpx.Request) -> httpx.Response:
    url = str(request.url)
    if "iframerpc" in url:
        return httpx.Response(
            200,
            json={"access_token": "google-token"},
            headers=[("set-cookie", "SID=new; Path=/; Max-Age=3600")],
        )
    if url.endswith("issue_jwt"):
        return httpx.Response(200, json={"jwt": "nest-jwt"})
    if url.endswith("/session"):
        return httpx.Response(
            200,
            json={
                "access_token": "session-token",
                "userid": "user-1",
                "email": "test@example.com",
                "expires_in": "Wed, 09-Nov-2033 00:00:00 GMT",
            },
        )
    if url.endswith("/app_launch"):
        return _app_launch_response()
    return httpx.Response(404)


async def _nest_handler(request: httpx.Request) -> httpx.Response:
    url = str(request.url)
    if url.endswith("/session"):
        return httpx.Response(
            200,
            json={"access_token": "legacy-token", "userid": "user-2"},
        )
    if url.endswith("/app_launch"):
        return _app_launch_response()
    return httpx.Response(404)


def test_parse_rooms_builds_thermostat_and_sensors():
    rooms = parse_rooms(BUCKETS, now=time.time())

    assert [room["kind"] for room in rooms] == ["thermostat", "sensor", "sensor"]
    thermostat = rooms[0]
    assert thermostat["name"] == "Living Room"
    assert thermostat["temperatureC"] == 21.5
    assert thermostat["humidity"] == 45
    assert thermostat["online"] is True

    basement = rooms[1]
    assert basement["room"] == "Kids Room"
    assert basement["active"] is True
    assert basement["online"] is True

    offline = rooms[2]
    assert offline["online"] is False
    assert offline["humidity"] is None


def test_parse_rooms_skips_missing_temperature_and_bad_values():
    buckets = [
        {"object_key": "device.a", "value": {"current_temperature": "nope"}},
        {"object_key": "kryptonite.b", "value": {"current_temperature": None}},
        {"object_key": "kryptonite.c", "value": {}},
        {"object_key": "kryptonite.d", "value": {"current_temperature": 20}},
    ]
    rooms = parse_rooms(buckets)
    assert [room["id"] for room in rooms] == ["kryptonite.d"]
    assert rooms[0]["name"] == "Temperature Sensor"


def test_cookie_helpers_merge_rotations_and_deletions():
    merged = merge_cookies(
        COOKIES,
        [
            "SID=fresh; Path=/; Max-Age=3600",
            "HSID=; Max-Age=0",
            "NEW=value",
        ],
    )
    assert "SID=fresh" in merged
    assert "HSID" not in merged
    assert "NEW=value" in merged

    assert merge_cookies(COOKIES, ["SID=abc; Path=/"]) == COOKIES
    assert merge_cookies(COOKIES, ["=broken"]) == COOKIES
    assert merge_cookies(COOKIES, ["SID=gone; Expires=Wed, 09 Nov 2000 00:00:00 GMT"]) == (
        "HSID=def; SSID=ghi"
    )
    assert merge_cookies(COOKIES, ["SID=gone; Expires=not a date"]) == (
        "SID=gone; HSID=def; SSID=ghi"
    )
    assert merge_cookies(COOKIES, ["SID=gone; Max-Age=abc"]) == ("SID=gone; HSID=def; SSID=ghi")


def test_google_credential_validation():
    with pytest.raises(NestAuthError):
        nest._validate_google_credentials("https://example.com", COOKIES)
    with pytest.raises(NestAuthError):
        nest._validate_google_credentials(
            "https://accounts.google.com/o/oauth2/iframerpc?x=1", COOKIES
        )
    with pytest.raises(NestAuthError):
        # Userinfo spoof: the real host is evil.example, not Google.
        nest._validate_google_credentials(
            "https://accounts.google.com@evil.example/o/oauth2/iframerpc?action=issueToken",
            COOKIES,
        )
    with pytest.raises(NestAuthError):
        nest._validate_google_credentials(
            "http://accounts.google.com/o/oauth2/iframerpc?action=issueToken", COOKIES
        )
    with pytest.raises(NestAuthError):
        nest._validate_google_credentials(ISSUE_TOKEN, "foo=bar")
    nest._validate_google_credentials(ISSUE_TOKEN, COOKIES)


async def test_save_load_and_clear_credentials(db_session):
    await save_credentials(
        db_session,
        account_type="google",
        issue_token=ISSUE_TOKEN + "\n",
        cookies="Cookie: " + COOKIES,
    )
    creds = await nest._load_credentials(db_session)
    assert creds == {"type": "google", "issue_token": ISSUE_TOKEN, "cookies": COOKIES}

    await save_credentials(db_session, account_type="nest", access_token=" legacy ")
    creds = await nest._load_credentials(db_session)
    assert creds == {"type": "nest", "access_token": "legacy"}

    # Saving again updates existing rows rather than adding duplicates.
    await save_credentials(db_session, account_type="nest", access_token="legacy2")
    creds = await nest._load_credentials(db_session)
    assert creds == {"type": "nest", "access_token": "legacy2"}

    await clear_credentials(db_session)
    assert await nest._load_credentials(db_session) is None

    with pytest.raises(NestAuthError):
        await save_credentials(db_session, account_type="nest", access_token="")
    with pytest.raises(NestAuthError):
        await save_credentials(db_session, account_type="other")


async def test_google_flow_persists_rotated_cookies(db_session):
    await save_credentials(
        db_session, account_type="google", issue_token=ISSUE_TOKEN, cookies=COOKIES
    )
    client = _client(_google_handler)
    try:
        status = await get_temperatures(db_session, force=True, client=client)
    finally:
        await client.aclose()

    assert status["configured"] is True
    assert status["connected"] is True
    assert status["authType"] == "google"
    assert len(status["rooms"]) == 3
    assert status["error"] is None

    saved = (await db_session.execute(select(ServerSetting))).scalars()
    cookies = {row.key: row.value for row in saved}["nest_cookies"]
    assert "SID=new" in cookies


async def test_legacy_flow_and_session_cache(db_session):
    await save_credentials(db_session, account_type="nest", access_token="legacy")
    calls = {"session": 0, "launch": 0}

    async def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).endswith("/session"):
            calls["session"] += 1
        if str(request.url).endswith("/app_launch"):
            calls["launch"] += 1
        return await _nest_handler(request)

    client = _client(handler)
    try:
        first = await get_temperatures(db_session, force=True, client=client)
        second = await get_temperatures(db_session, force=True, client=client)
    finally:
        await client.aclose()

    assert first["connected"] is True
    assert second["connected"] is True
    assert calls == {"session": 1, "launch": 2}


async def test_cached_status_short_circuits_refresh(db_session):
    await save_credentials(db_session, account_type="nest", access_token="legacy")

    async def failing(request: httpx.Request) -> httpx.Response:
        raise AssertionError("network should not be used while cached")

    client = _client(_nest_handler)
    try:
        first = await get_temperatures(db_session, force=True, client=client)
    finally:
        await client.aclose()
    assert first["connected"] is True

    cached = await get_temperatures(db_session, client=_client(failing))
    assert cached is first


async def test_auth_failure_keeps_last_readings(db_session):
    await save_credentials(db_session, account_type="nest", access_token="legacy")
    good = _client(_nest_handler)
    try:
        first = await get_temperatures(db_session, force=True, client=good)
    finally:
        await good.aclose()

    async def unauthorized(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401)

    bad = _client(unauthorized)
    try:
        status = await get_temperatures(db_session, force=True, client=bad)
    finally:
        await bad.aclose()

    assert status["connected"] is False
    assert status["rooms"] == first["rooms"]
    assert status["updatedAt"] == first["updatedAt"]
    assert "sign-in expired" in status["error"]


async def test_transient_and_unexpected_failures(db_session):
    await save_credentials(db_session, account_type="nest", access_token="legacy")

    async def server_error(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    client = _client(server_error)
    try:
        status = await get_temperatures(db_session, force=True, client=client)
    finally:
        await client.aclose()
    assert status["connected"] is False
    assert "Could not reach Nest" in status["error"]

    async def boom(request: httpx.Request) -> httpx.Response:
        raise RuntimeError("boom")

    reset_nest_cache()
    client = _client(boom)
    try:
        status = await get_temperatures(db_session, force=True, client=client)
    finally:
        await client.aclose()
    assert status["connected"] is False
    assert "Could not reach Nest" in status["error"]


async def test_unconfigured_status(db_session):
    status = await get_temperatures(db_session, force=True)
    assert status == {
        "configured": False,
        "authType": None,
        "connected": False,
        "rooms": [],
        "updatedAt": None,
        "error": None,
    }


async def test_request_json_error_branches():
    async def handler(request: httpx.Request) -> httpx.Response:
        path = str(request.url)
        if path.endswith("/forbidden"):
            return httpx.Response(403)
        if path.endswith("/ratelimit"):
            return httpx.Response(429)
        if path.endswith("/badstatus"):
            return httpx.Response(400)
        if path.endswith("/badjson"):
            return httpx.Response(200, content=b"not json")
        if path.endswith("/list"):
            return httpx.Response(200, json=[])
        return httpx.Response(200, json={"ok": True})

    client = _client(handler)
    try:
        with pytest.raises(NestAuthError):
            await nest._request_json(client, "GET", "https://x/forbidden")
        with pytest.raises(NestServiceError):
            await nest._request_json(client, "GET", "https://x/ratelimit")
        with pytest.raises(NestAuthError):
            await nest._request_json(client, "GET", "https://x/badstatus")
        with pytest.raises(NestServiceError):
            await nest._request_json(client, "GET", "https://x/badjson")
        with pytest.raises(NestServiceError):
            await nest._request_json(client, "GET", "https://x/list")
        data, _ = await nest._request_json(client, "GET", "https://x/ok")
        assert data == {"ok": True}
    finally:
        await client.aclose()

    async def offline(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    client = _client(offline)
    try:
        with pytest.raises(NestServiceError):
            await nest._request_json(client, "GET", "https://x/offline")
    finally:
        await client.aclose()


async def test_missing_tokens_and_sessions():
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={})

    client = _client(handler)
    try:
        with pytest.raises(NestAuthError):
            await nest._get_google_access_token(client, ISSUE_TOKEN, COOKIES)
        with pytest.raises(NestAuthError):
            await nest._get_nest_jwt(client, "google")
        with pytest.raises(NestAuthError):
            await nest._get_session(client, "token")
    finally:
        await client.aclose()


async def test_new_client_factory():
    client = nest._new_client()
    await client.aclose()


def test_session_expiry_parsing():
    assert nest._session_expiry("Wed, 09-Nov-2033 00:00:00 GMT") > time.time()
    assert nest._session_expiry("not a date") > time.time()
    assert nest._session_expiry(None) > time.time()


async def test_app_launch_rejects_error_and_bad_shape():
    responses = [
        httpx.Response(200, json={"error": "nope"}),
        httpx.Response(200, json={"updated_buckets": "nope"}),
    ]

    async def handler(request: httpx.Request) -> httpx.Response:
        return responses.pop(0)

    client = _client(handler)
    try:
        with pytest.raises(NestServiceError):
            await nest._app_launch(client, {"userid": "u", "access_token": "t"})
        with pytest.raises(NestServiceError):
            await nest._app_launch(client, {"userid": "u", "access_token": "t"})
    finally:
        await client.aclose()


async def test_app_launch_reauth_retry(db_session):
    await save_credentials(db_session, account_type="nest", access_token="legacy")
    launches = {"count": 0}

    async def handler(request: httpx.Request) -> httpx.Response:
        path = str(request.url)
        if path.endswith("/session"):
            return httpx.Response(200, json={"access_token": "legacy-token", "userid": "user-2"})
        if path.endswith("/app_launch"):
            launches["count"] += 1
            if launches["count"] == 1:
                return httpx.Response(401)
            return _app_launch_response()
        return httpx.Response(404)

    client = _client(handler)
    try:
        status = await get_temperatures(db_session, force=True, client=client)
    finally:
        await client.aclose()

    assert status["connected"] is True
    assert launches["count"] == 2


async def test_nest_endpoints(client, db_session, monkeypatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        if str(request.url).endswith("/session"):
            return httpx.Response(200, json={"access_token": "legacy-token", "userid": "user-2"})
        return _app_launch_response()

    def fake_client():
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(nest, "_new_client", fake_client)

    unconfigured = await client.get("/api/v1/nest/temperatures")
    assert unconfigured.status_code == 200
    assert unconfigured.json()["configured"] is False

    saved = await client.post(
        "/api/v1/nest/credentials",
        json={"account_type": "nest", "access_token": "legacy"},
    )
    assert saved.status_code == 200
    assert saved.json()["connected"] is True

    refreshed = await client.get("/api/v1/nest/temperatures?refresh=true")
    assert refreshed.status_code == 200
    assert len(refreshed.json()["rooms"]) == 3

    removed = await client.delete("/api/v1/nest/credentials")
    assert removed.status_code == 200
    assert (await client.get("/api/v1/nest/temperatures")).json()["configured"] is False


async def test_nest_endpoint_rejects_bad_credentials(client):
    response = await client.post(
        "/api/v1/nest/credentials",
        json={"account_type": "google", "issue_token": "https://bad", "cookies": "x"},
    )
    assert response.status_code == 422
    assert "issue token" in response.json()["detail"]
