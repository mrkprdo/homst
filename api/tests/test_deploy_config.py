"""Regression tests for the shipped nginx deployment configs.

The configs are read straight from disk; no app modules are imported and no
network access happens.
"""

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
PROD_CONFIGS = [
    REPO_ROOT / "docker" / "nginx.conf",
    REPO_ROOT / "nginx" / "nginx.prod.conf",
]
DEV_CONFIG = REPO_ROOT / "nginx" / "nginx.dev.conf"

PROD_CSP = (
    "default-src 'self'; base-uri 'none'; object-src 'none'; "
    "frame-ancestors 'none'; form-action 'self'; script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; "
    "font-src 'self' data:; connect-src 'self' https://api.spotify.com "
    "https://accounts.spotify.com https://lrclib.net https://api.open-meteo.com "
    "https://geocoding-api.open-meteo.com; media-src 'self' blob:; "
    "worker-src 'self' blob:; manifest-src 'self';"
)
PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=()"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _location_block(config: str, name: str) -> str:
    """Return the full brace-balanced body of a location block."""
    marker = f"location {name} {{"
    start = config.index(marker)
    depth = 0
    for index in range(start, len(config)):
        if config[index] == "{":
            depth += 1
        elif config[index] == "}":
            depth -= 1
            if depth == 0:
                return config[start : index + 1]
    raise AssertionError(f"unbalanced braces after {marker}")


@pytest.mark.parametrize("path", PROD_CONFIGS, ids=lambda p: p.name)
def test_prod_config_sets_security_headers(path: Path):
    config = _read(path)

    assert "server_tokens off;" in config
    assert 'add_header X-Frame-Options "DENY" always;' in config
    assert 'add_header X-Content-Type-Options "nosniff" always;' in config
    assert 'add_header Referrer-Policy "strict-origin-when-cross-origin" always;' in config
    assert f'add_header Permissions-Policy "{PERMISSIONS_POLICY}" always;' in config
    assert 'add_header Cross-Origin-Opener-Policy "same-origin" always;' in config
    assert f'add_header Content-Security-Policy "{PROD_CSP}" always;' in config

    # The directives that matter most, called out on their own so a rewrite
    # cannot silently weaken them.
    assert "frame-ancestors 'none'" in PROD_CSP
    assert "script-src 'self'" in PROD_CSP


@pytest.mark.parametrize("path", PROD_CONFIGS, ids=lambda p: p.name)
def test_prod_config_limits_api_requests_and_connections(path: Path):
    config = _read(path)

    assert "client_max_body_size 12M;" in config
    assert "limit_req_zone $binary_remote_addr zone=homst_api:10m rate=20r/s;" in config
    assert "limit_conn_zone $binary_remote_addr zone=homst_conn:10m;" in config
    assert "limit_req_status 429;" in config
    assert "limit_conn_status 429;" in config

    api = _location_block(config, "/api/")
    assert "limit_req zone=homst_api burst=40 nodelay;" in api
    assert "limit_conn homst_conn 20;" in api


@pytest.mark.parametrize("path", PROD_CONFIGS, ids=lambda p: p.name)
def test_uploads_location_is_isolated(path: Path):
    config = _read(path)
    uploads = _location_block(config, "/uploads/")

    # A location with any add_header stops inheriting the server-level ones,
    # so each header has to be present here explicitly.
    assert 'add_header Content-Security-Policy "default-src \'none\'; sandbox" always;' in uploads
    assert 'add_header X-Content-Type-Options "nosniff" always;' in uploads
    assert 'add_header X-Frame-Options "DENY" always;' in uploads
    assert 'add_header Referrer-Policy "no-referrer" always;' in uploads


def test_dev_config_allows_vite_hmr_but_keeps_headers():
    config = _read(DEV_CONFIG)

    assert "server_tokens off;" in config
    assert "client_max_body_size 12M;" in config
    assert 'add_header X-Frame-Options "DENY" always;' in config
    assert 'add_header X-Content-Type-Options "nosniff" always;' in config
    assert 'add_header Referrer-Policy "strict-origin-when-cross-origin" always;' in config

    csp_line = next(
        line for line in config.splitlines() if "add_header Content-Security-Policy" in line
    )
    assert "frame-ancestors 'none'" in csp_line
    assert "'unsafe-eval'" in csp_line  # Vite evaluates modules in dev
    assert "ws:" in csp_line and "wss:" in csp_line  # HMR websocket
    assert "img-src 'self' data: blob: https:" in csp_line

    # Prod rate limiting only ever applies to the prod configs.
    assert "limit_req_zone" not in config
