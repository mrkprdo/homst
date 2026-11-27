from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:dev@localhost:5432/homst"
    database_url_alembic: str = "postgresql://postgres:dev@localhost:5432/homst"

    redis_url: str = "redis://localhost:6379"

    cors_allow_all: bool = False
    allowed_origins: str = "http://localhost:5173"
    allowed_hosts: str = ""

    mdns_enabled: bool = True
    mdns_instance_name: str = "HOMST"

    debug: bool = False

    google_calendar_client_id: str = ""
    google_calendar_client_secret: str = ""

    spotify_client_id: str = ""

    opencode_api_key: str = ""
    opencode_provider: str = "console"
    opencode_model: str = "deepseek-v4.1-flash"

    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:homst@localhost"

    homst_updater_url: str = ""
    homst_self_update_disabled: bool = False

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
