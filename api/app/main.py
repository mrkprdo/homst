import asyncio
import logging
import os
import socket
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.config import settings
from app.db import Base, engine
from app.mdns import homst_mdns
from app.redis_client import close_redis, get_redis
from app.routers import calendar, holidays, stream, sync, tasks, users
from app.routers.announcements import router as announcements_router
from app.routers.notifications import router as notifications_router
from app.routers.photos import router as photos_router
from app.routers.push import router as push_router
from app.routers.settings import router as settings_router
from app.routers.system import router as system_router
from app.version import VERSION

logger = logging.getLogger(__name__)

_SAFE_MIGRATIONS = [
    "ALTER TABLE members ADD COLUMN IF NOT EXISTS color VARCHAR(50)",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS assignee_id VARCHAR(36)",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER",
    "ALTER TABLE members DROP COLUMN IF EXISTS email",
    "DELETE FROM reminder_log WHERE channel = 'email'",
]

# ── Retry settings for database startup ──
_DB_RETRY_MAX = 15
_DB_RETRY_DELAY = 2  # seconds, doubles each attempt


async def _wait_for_database(
    max_retries: int = _DB_RETRY_MAX, initial_delay: float = _DB_RETRY_DELAY
):
    """Connect to the database with exponential backoff.

    This handles transient DNS resolution failures and other startup
    race conditions in containerised environments (Docker Compose,
    Kubernetes, etc.).
    """
    last_exc = None
    delay = initial_delay

    for attempt in range(1, max_retries + 1):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
                for stmt in _SAFE_MIGRATIONS:
                    await conn.execute(text(stmt))
            logger.info("Database connection established successfully")
            return
        except (OperationalError, OSError, socket.gaierror) as exc:
            last_exc = exc
            logger.warning(
                "Database connection attempt %d/%d failed: %s. Retrying in %.1fs…",
                attempt,
                max_retries,
                exc,
                delay,
            )
            await asyncio.sleep(delay)
            delay *= 2  # exponential backoff

    logger.critical("Could not connect to the database after %d attempts", max_retries)
    raise last_exc  # type: ignore[misc]


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _wait_for_database()
    await get_redis()
    if settings.mdns_enabled:
        homst_mdns.instance_name = settings.mdns_instance_name
        await homst_mdns.start()
    yield
    if settings.mdns_enabled:
        await homst_mdns.stop()
    await close_redis()
    await engine.dispose()


app = FastAPI(
    title="HOMST API",
    version=VERSION,
    lifespan=lifespan,
)

# ── CORS ──
if settings.cors_allow_all:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins.split(","),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# ── Routers ──
app.include_router(users.router, prefix="/api/v1", tags=["users"])
app.include_router(calendar.router, prefix="/api/v1", tags=["calendar"])
app.include_router(tasks.router, prefix="/api/v1", tags=["tasks"])
app.include_router(holidays.router, prefix="/api/v1", tags=["holidays"])
app.include_router(settings_router, prefix="/api/v1/household", tags=["settings"])
app.include_router(sync.router, prefix="/api/v1", tags=["sync"])
app.include_router(stream.router, prefix="/api", tags=["stream"])
app.include_router(photos_router, prefix="/api/v1", tags=["photos"])
app.include_router(announcements_router, prefix="/api/v1", tags=["announcements"])
app.include_router(notifications_router, prefix="/api/v1", tags=["notifications"])
app.include_router(push_router, prefix="/api/v1", tags=["push"])
app.include_router(system_router, prefix="/api/v1/system", tags=["system"])

# ── Static files (photo uploads) ──
os.makedirs("uploads/photos", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/v1/config")
async def public_config():
    """Non-secret, client-visible configuration (safe to serve publicly)."""
    return {"spotify_client_id": settings.spotify_client_id}
