from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Database ──
    database_url: str = "postgresql+asyncpg://postgres:dev@localhost:5432/homst"
    database_url_alembic: str = "postgresql://postgres:dev@localhost:5432/homst"

    # ── Redis ──
    redis_url: str = "redis://localhost:6379"

    # ── CORS ──
    cors_allow_all: bool = True
    allowed_origins: str = "http://localhost:5173"

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
