"""Transport-level hardening: Host allow-list, CORS and cross-site writes.

HOMST has no auth cookies, so the browser itself is the security boundary.
These tests pin down the defaults that keep the LAN deployment working while
refusing writes that another website tries to make on the user's behalf.
"""

import json

from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.config import Settings, settings
from app.main import _cors_origins, _csv, _hostname, app

UNSUBSCRIBE = "/api/v1/push/unsubscribe"
SUBSCRIBE_BODY = {"endpoint": "https://fcm.googleapis.com/x"}


def _installed(cls):
    return [m for m in app.user_middleware if getattr(m, "cls", None) is cls]


# ══════════════════════════════════════════════════════════════════════
# Defaults and middleware wiring
# ══════════════════════════════════════════════════════════════════════


def test_default_settings_are_not_cross_site_open():
    fields = Settings.model_fields
    assert fields["cors_allow_all"].default is False
    assert fields["allowed_origins"].default == "http://localhost:5173"
    # Empty host allow-list keeps plain-IP LAN access working.
    assert fields["allowed_hosts"].default == ""


def test_cors_middleware_uses_explicit_origins_without_credentials():
    installed = _installed(CORSMiddleware)
    assert len(installed) == 1, "exactly one CORS middleware should be added"

    kwargs = installed[0].kwargs
    assert kwargs["allow_origins"] == _cors_origins()
    assert kwargs["allow_origins"] == _csv(settings.allowed_origins)
    assert kwargs["allow_origins"] == ["http://localhost:5173"]
    assert "*" not in kwargs["allow_origins"]
    assert kwargs["allow_credentials"] is False
    assert kwargs["allow_methods"] == ["*"]
    assert kwargs["allow_headers"] == ["*"]


def test_cors_allow_all_is_still_an_explicit_debug_opt_in(monkeypatch):
    assert _cors_origins() == ["http://localhost:5173"]
    monkeypatch.setattr(settings, "cors_allow_all", True)
    assert _cors_origins() == ["*"]


def test_trusted_host_middleware_defaults_to_allow_all_hosts():
    installed = _installed(TrustedHostMiddleware)
    assert len(installed) == 1
    assert installed[0].kwargs["allowed_hosts"] == ["*"]
    # The empty-string fallback used at import time.
    assert _csv("") == []
    assert (_csv("") or ["*"]) == ["*"]


# ══════════════════════════════════════════════════════════════════════
# Small parsing helpers
# ══════════════════════════════════════════════════════════════════════


def test_csv_splits_trims_and_drops_blanks():
    assert _csv("http://a.test, http://b.test") == ["http://a.test", "http://b.test"]
    assert _csv("  http://a.test ,, http://b.test , ") == [
        "http://a.test",
        "http://b.test",
    ]
    assert _csv("") == []
    assert _csv(" , , ") == []


def test_hostname_is_port_insensitive_and_tolerates_junk():
    assert _hostname("http://test:5173") == "test"
    assert _hostname("https://EXAMPLE.test") == "example.test"
    assert _hostname("test:8000") == "test"
    assert _hostname("[::1]:8000") == "::1"
    assert _hostname(None) is None
    assert _hostname("") is None
    assert _hostname("   ") is None


# ══════════════════════════════════════════════════════════════════════
# CORS preflight
# ══════════════════════════════════════════════════════════════════════


async def test_preflight_from_disallowed_origin_is_rejected(client):
    response = await client.options(
        UNSUBSCRIBE,
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


async def test_preflight_from_configured_origin_succeeds(client):
    response = await client.options(
        UNSUBSCRIBE,
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


# ══════════════════════════════════════════════════════════════════════
# Cross-site state-changing requests
# ══════════════════════════════════════════════════════════════════════


async def test_post_from_foreign_origin_is_blocked(client):
    response = await client.post(
        UNSUBSCRIBE, json=SUBSCRIBE_BODY, headers={"Origin": "https://evil.example"}
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "Cross-origin request blocked."}


async def test_post_from_same_origin_is_allowed(client):
    response = await client.post(UNSUBSCRIBE, json=SUBSCRIBE_BODY, headers={"Origin": "http://test"})
    assert response.status_code == 200
    assert response.json() == {"message": "unsubscribed"}


async def test_post_without_origin_is_allowed(client):
    # Non-browser clients (curl, the reminder worker) send no Origin.
    response = await client.post(UNSUBSCRIBE, json=SUBSCRIBE_BODY)
    assert response.status_code == 200
    assert response.json() == {"message": "unsubscribed"}


async def test_get_from_foreign_origin_is_not_blocked(client):
    response = await client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_post_with_cross_site_fetch_metadata_is_blocked(client):
    response = await client.post(
        UNSUBSCRIBE,
        json=SUBSCRIBE_BODY,
        headers={"Origin": "http://test", "Sec-Fetch-Site": "cross-site"},
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "Cross-origin request blocked."}


async def test_forwarded_host_is_honoured_and_ports_are_ignored(client):
    response = await client.post(
        UNSUBSCRIBE,
        json=SUBSCRIBE_BODY,
        headers={
            "Origin": "http://test:8443",
            "X-Forwarded-Host": "test:8000, internal-proxy",
        },
    )
    assert response.status_code == 200
    assert response.json() == {"message": "unsubscribed"}


async def test_forwarded_host_mismatch_is_blocked(client):
    response = await client.post(
        UNSUBSCRIBE,
        json=SUBSCRIBE_BODY,
        headers={
            "Origin": "http://evil.example",
            "X-Forwarded-Host": "test",
        },
    )
    assert response.status_code == 403
    assert json.loads(response.content) == {"detail": "Cross-origin request blocked."}
