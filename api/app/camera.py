"""RTSP camera -> HLS bridge.

Browsers cannot play ``rtsp://`` URLs. When a camera is configured, ffmpeg
transcodes its stream into a short HLS playlist that the dashboard plays with
hls.js. Only one API worker owns the ffmpeg process at a time; a Redis key
elects that worker and the shared ``/tmp`` directory lets every worker serve
the resulting playlist and segments.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import re
import shutil
import tempfile
import uuid
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

from app.redis_client import get_redis

logger = logging.getLogger(__name__)

PLAYLIST_NAME = "index.m3u8"
SEGMENT_PATTERN = re.compile(r"^seg_\d+\.ts$")
TOKEN_PATTERN = re.compile(r"^[a-f0-9]{16}$")

START_TIMEOUT = 10.0
POLL_INTERVAL = 0.2
LOCK_TTL_SECONDS = 20
REFRESH_SECONDS = 5
STOP_TIMEOUT = 5.0

MAX_URL_LENGTH = 2048
MAX_CREDENTIAL_LENGTH = 255
ROTATIONS = {0, 90, 180, 270}

OWNER_KEY = "homst:camera:owner"
WORKER_ID = uuid.uuid4().hex

# Shared by every gunicorn worker in the same container.
CAMERA_ROOT = Path(tempfile.gettempdir()) / "homst-camera"


class CameraError(RuntimeError):
    """A camera configuration or streaming problem the API can report."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def build_stream_url(camera: dict | None) -> str | None:
    """Return the URL ffmpeg should open, with credentials inserted safely."""
    if not camera:
        return None
    url = str(camera.get("url") or "").strip()
    if not url:
        return None
    if len(url) > MAX_URL_LENGTH:
        raise CameraError("Camera URL is too long.", 422)

    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise CameraError("Camera URL is not valid.", 422) from exc

    if parsed.scheme.lower() not in {"rtsp", "rtsps", "http", "https"}:
        raise CameraError(
            "Camera URL must start with rtsp://, rtsps://, http:// or https://.", 422
        )
    if not parsed.hostname:
        raise CameraError("Camera URL needs a host name.", 422)

    username = str(camera.get("username") or "")
    password = str(camera.get("password") or "")
    if len(username) > MAX_CREDENTIAL_LENGTH or len(password) > MAX_CREDENTIAL_LENGTH:
        raise CameraError("Camera username or password is too long.", 422)

    if username:
        host = parsed.hostname
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        netloc = f"{quote(username, safe='')}:{quote(password, safe='')}@{host}"
        if port is not None:
            netloc += f":{port}"
        parsed = parsed._replace(netloc=netloc)
    return urlunsplit(parsed)


def camera_token(source: str) -> str:
    """Stable, non-secret path token for one source (URL + credentials)."""
    return hashlib.sha256(source.encode()).hexdigest()[:16]


def camera_stream_path(camera: dict | None) -> str | None:
    """The HLS playlist path clients should load, or None when unconfigured."""
    try:
        source = build_stream_url(camera)
    except CameraError:
        return None
    if not source:
        return None
    return f"/api/v1/camera/hls/{camera_token(source)}/{PLAYLIST_NAME}"


def _camera_rotation(value: object, fallback: int = 0) -> int:
    try:
        rotation = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback
    return rotation if rotation in ROTATIONS else fallback


def public_camera_settings(camera: object) -> dict | None:
    """Camera settings safe to send to clients: never include the password."""
    if not isinstance(camera, dict):
        return None
    return {
        "url": str(camera.get("url") or ""),
        "username": str(camera.get("username") or ""),
        "passwordSet": bool(camera.get("password")),
        "rotation": _camera_rotation(camera.get("rotation")),
        "streamPath": camera_stream_path(camera),
    }


def merge_camera_settings(raw: object, existing: object = None) -> dict | None:
    """Validate and merge an incoming camera payload with stored settings.

    A missing ``password`` keeps the stored one, so the settings form can be
    saved without ever receiving the secret back. ``clearPassword`` removes it.
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise CameraError("Camera settings are not valid.", 422)

    previous = existing if isinstance(existing, dict) else {}
    url = str(raw.get("url") or "").strip()
    if not url:
        return None

    username = str(raw.get("username") or "").strip()
    if raw.get("clearPassword"):
        password = ""
    elif "password" in raw:
        password = str(raw.get("password") or "")
    else:
        password = str(previous.get("password") or "")

    rotation = raw.get("rotation", previous.get("rotation", 0))
    try:
        rotation = int(rotation)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise CameraError("Camera rotation must be 0, 90, 180 or 270.", 422) from exc
    if rotation not in ROTATIONS:
        raise CameraError("Camera rotation must be 0, 90, 180 or 270.", 422)

    camera = {
        "url": url,
        "username": username,
        "password": password,
        "rotation": rotation,
    }
    build_stream_url(camera)
    return camera


def output_dir(token: str) -> Path:
    return CAMERA_ROOT / token


def playlist_path(token: str) -> Path:
    return output_dir(token) / PLAYLIST_NAME


def _as_text(value: object) -> str | None:
    if isinstance(value, bytes):
        return value.decode()
    return value if isinstance(value, str) else None


def _read_ffmpeg_log(directory: Path, source: str) -> str:
    """Return the last ffmpeg error line, with credentials removed."""
    try:
        text = (directory / "ffmpeg.log").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    text = text.replace(source, "camera")
    # ffmpeg may echo the URL in a normalized form; strip userinfo anyway.
    text = re.sub(r"(rtsps?|https?)://[^/\s@]+@", r"\1://***@", text)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines[-1][:240] if lines else ""


class CameraStream:
    """Owns this worker's ffmpeg process and the shared HLS lock."""

    def __init__(self) -> None:
        self._lock: asyncio.Lock | None = None
        self._lock_loop: asyncio.AbstractEventLoop | None = None
        self._process: asyncio.subprocess.Process | None = None
        self._source: str | None = None
        self._token: str | None = None
        self._refresh_task: asyncio.Task | None = None

    def _get_lock(self) -> asyncio.Lock:
        """Re-create the lock when tests (or a reload) use a new event loop."""
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock = asyncio.Lock()
            self._lock_loop = loop
        return self._lock

    async def ensure(self, camera: dict | None) -> Path:
        """Make sure the stream is running and return its HLS directory."""
        source = build_stream_url(camera)
        if not source:
            raise CameraError("No camera URL is configured.", 404)
        token = camera_token(source)

        async with self._get_lock():
            running = self._process is not None and self._process.returncode is None
            if running and self._source == source:
                await self._refresh_owner()
                return output_dir(token)

            try:
                redis = await get_redis()
                owner = _as_text(await redis.get(OWNER_KEY))
            except Exception as exc:
                raise CameraError("Camera streaming is unavailable.", 503) from exc

            if owner and owner != WORKER_ID:
                await self._wait_for_playlist(token)
                return output_dir(token)

            if not owner:
                claimed = await redis.set(
                    OWNER_KEY, WORKER_ID, nx=True, ex=LOCK_TTL_SECONDS
                )
                if not claimed:
                    await self._wait_for_playlist(token)
                    return output_dir(token)

            # We own the lock. Restart if the source changed or ffmpeg died.
            if not running or self._source != source:
                await self._stop_locked()
                await self._start_locked(source, token)
                try:
                    await redis.set(OWNER_KEY, WORKER_ID, ex=LOCK_TTL_SECONDS)
                except Exception as exc:
                    await self._stop_locked()
                    raise CameraError("Camera streaming is unavailable.", 503) from exc
                self._refresh_task = asyncio.create_task(self._keep_ownership(source))
            return output_dir(token)

    async def _refresh_owner(self) -> None:
        try:
            redis = await get_redis()
            await redis.expire(OWNER_KEY, LOCK_TTL_SECONDS)
        except Exception:
            logger.warning("Could not refresh camera stream ownership", exc_info=True)

    async def _wait_for_playlist(
        self, token: str, process: asyncio.subprocess.Process | None = None
    ) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + START_TIMEOUT
        while loop.time() < deadline:
            path = playlist_path(token)
            try:
                if path.is_file() and path.stat().st_size > 0:
                    return
            except OSError:
                pass
            if process is not None and process.returncode is not None:
                raise CameraError("The camera stream could not be opened.")
            await asyncio.sleep(POLL_INTERVAL)
        raise CameraError("The camera stream did not start in time.")

    async def _start_locked(self, source: str, token: str) -> None:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise CameraError(
                "Camera streaming needs ffmpeg installed on the server.", 503
            )

        directory = output_dir(token)
        shutil.rmtree(directory, ignore_errors=True)
        directory.mkdir(parents=True, exist_ok=True)

        args = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
        ]
        if source.lower().startswith(("rtsp://", "rtsps://")):
            args += ["-rtsp_transport", "tcp"]
        args += [
            "-i",
            source,
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-profile:v",
            "baseline",
            "-pix_fmt",
            "yuv420p",
            "-vf",
            "scale=1280:720:force_original_aspect_ratio=decrease,"
            "pad=1280:720:(ow-iw)/2:(oh-ih)/2",
            "-r",
            "20",
            "-g",
            "40",
            "-f",
            "hls",
            "-hls_time",
            "2",
            "-hls_list_size",
            "6",
            "-hls_flags",
            "delete_segments+omit_endlist+independent_segments",
            "-hls_segment_filename",
            str(directory / "seg_%06d.ts"),
            str(directory / PLAYLIST_NAME),
        ]

        log_path = directory / "ffmpeg.log"
        try:
            log_file = open(log_path, "wb")
            try:
                process = await asyncio.create_subprocess_exec(
                    *args,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=log_file,
                )
            finally:
                log_file.close()
        except OSError as exc:
            detail = _read_ffmpeg_log(directory, source)
            if detail:
                logger.warning("Camera ffmpeg failed to start: %s", detail)
            shutil.rmtree(directory, ignore_errors=True)
            message = f"Could not start the camera stream. {detail}".strip()
            raise CameraError(message, 503) from exc

        self._process = process
        self._source = source
        self._token = token
        try:
            await self._wait_for_playlist(token, process)
        except CameraError as exc:
            detail = _read_ffmpeg_log(directory, source)
            if detail:
                logger.warning("Camera ffmpeg failed: %s", detail)
            await self._stop_locked()
            if detail:
                raise CameraError(f"{exc} ffmpeg: {detail}") from exc
            raise

    async def _keep_ownership(self, source: str) -> None:
        while True:
            await asyncio.sleep(REFRESH_SECONDS)
            if self._source != source:
                return
            try:
                redis = await get_redis()
                owner = _as_text(await redis.get(OWNER_KEY))
                if owner != WORKER_ID:
                    await self.stop()
                    return
                await redis.expire(OWNER_KEY, LOCK_TTL_SECONDS)
            except Exception:
                logger.warning("Could not refresh camera stream ownership", exc_info=True)

    async def stop(self) -> None:
        async with self._get_lock():
            await self._stop_locked()

    async def _stop_locked(self) -> None:
        task = self._refresh_task
        self._refresh_task = None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        process = self._process
        token = self._token
        self._process = None
        self._source = None
        self._token = None

        if process is not None and process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=STOP_TIMEOUT)
            except asyncio.TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    process.kill()
                with contextlib.suppress(ProcessLookupError):
                    await process.wait()
            except ProcessLookupError:
                pass

        if token:
            shutil.rmtree(output_dir(token), ignore_errors=True)

        try:
            redis = await get_redis()
            owner = _as_text(await redis.get(OWNER_KEY))
            if owner == WORKER_ID:
                await redis.delete(OWNER_KEY)
        except Exception:
            logger.warning("Could not release camera stream ownership", exc_info=True)


camera_stream = CameraStream()


async def release_camera_stream() -> None:
    """Release the shared lock and stop this worker's ffmpeg process."""
    try:
        redis = await get_redis()
        await redis.delete(OWNER_KEY)
    except Exception:
        logger.warning("Could not release camera stream lock", exc_info=True)
    await camera_stream.stop()


async def shutdown_camera_stream() -> None:
    await release_camera_stream()
