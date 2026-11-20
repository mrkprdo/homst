from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Database ──
    database_url: str = "postgresql+asyncpg://postgres:dev@localhost:5432/homst"
    database_url_alembic: str = "postgresql://postgres:dev@localhost:5432/homst"

    # ── Redis ──
    redis_url: str = "redis://localhost:6379"

    # ── CORS ──
    # Cross-origin access is opt-in: list the exact frontend origins in
    # ALLOWED_ORIGINS. Set CORS_ALLOW_ALL=true only for trusted dev setups.
    cors_allow_all: bool = False
    allowed_origins: str = "http://localhost:5173"
    # Optional comma-separated Host allow-list (TrustedHostMiddleware).
    # Empty means "allow any Host", which keeps LAN access by IP working.
    allowed_hosts: str = ""

    # ── mDNS ──
    mdns_enabled: bool = True
    mdns_instance_name: str = "HOMST"

    # ── Debug ──
    # SQL echo / verbose logging. Dev sets DEBUG=true; production is quiet
    # by default (override via .env).
    debug: bool = False

    # ── External Services ──
    google_calendar_client_id: str = ""
    google_calendar_client_secret: str = ""

    # ── Spotify ──
    # Optional Client ID for the "Now Playing" widget. Set it to share one
    # Spotify app client ID with every display; when empty, each browser can
    # paste its own in the widget.
    spotify_client_id: str = ""

    # ── Smart import (AI) ──
    # Optional server-wide OpenCode API key. Households normally paste their
    # key in Settings → Smart import, where it is stored server-side and never
    # returned to clients. Setting this env var is a convenient alternative
    # for an appliance-style install; the UI value wins when both exist.
    opencode_api_key: str = ""
    # "console" (pay-as-you-go) or "go". Only these two fixed gateways are
    # ever used, so a household key cannot be redirected to another host.
    opencode_provider: str = "console"
    opencode_model: str = "deepseek-v4.1-flash"

    # ── Web Push (VAPID) ──
    # Leave the key pair blank to have HOMST generate one on first use and
    # persist it in the database. Set both to pin your own keys instead.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    # Contact address advertised to push services; must be a mailto: or URL.
    vapid_subject: str = "mailto:homst@localhost"

    # ── In-app updates ──
    # The updater sidecar runs as an optional Compose profile and listens on
    # this internal URL. Leave blank to disable the feature (the UI then shows
    # the manual upgrade command).
    homst_updater_url: str = ""
    # Hard kill switch for the UI and background updater.
    homst_self_update_disabled: bool = False

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
