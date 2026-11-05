"""RTSP camera -> HLS bridge.

Browsers cannot play ``rtsp://`` URLs. When a camera is configured, ffmpeg
transcodes its stream into a short HLS playlist that the dashboard plays with
hls.js. Only one API worker owns the ffmpeg process at a time; a Redis key
elects that worker and the shared ``/tmp`` directory lets every worker serve
the resulting playlist and segments.

This is a fan-out, not a per-viewer proxy: ffmpeg opens the camera once and
writes each segment to disk, and every HLS client downloads those same files.
Adding viewers therefore adds HTTP traffic (and, in front, nginx work) but
never a second ffmpeg process or a second RTSP connection to the camera.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import re
import shutil
import tempfile
import time
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
# A restart can spend up to STOP_TIMEOUT + START_TIMEOUT; hold the election
# long enough that no other worker can start a competing ffmpeg mid-restart.
RESTART_LOCK_TTL_SECONDS = 60
REFRESH_SECONDS = 5
# Playlist requests arrive from every viewer, so only renew the shared lock
# when a meaningful part of its TTL has elapsed instead of once per request.
OWNER_REFRESH_INTERVAL = REFRESH_SECONDS / 2
STOP_TIMEOUT = 5.0

MAX_URL_LENGTH = 2048
MAX_CREDENTIAL_LENGTH = 255
ROTATIONS = {0, 90, 180, 270}

OWNER_KEY = "homst:camera:owner"
WORKER_ID = uuid.uuid4().hex

# Shared by every gunicorn worker in the same container.
CAMERA_ROOT = Path(tempfile.gettempdir()) / "homst-camera"

HEALTH_CHECK_INTERVAL = 5.0
HEALTH_STALL_THRESHOLD = 15.0
HEALTH_RETRY_INTERVAL = 60.0
MAX_HEALTH_RETRIES = 3

# One conservative rendition: the camera card is a small tile, and some
# household clients are low-powered (older Raspberry Pis). 540p at 15 fps with
# a capped bitrate keeps decode and Wi-Fi load well below 720p20.
VIDEO_WIDTH = 960
VIDEO_HEIGHT = 540
VIDEO_FPS = 15
VIDEO_BITRATE = "1200k"
VIDEO_BUFSIZE = "2400k"

# Keep a long enough live window that a client on a slow link can fall behind
# without the segment it needs being deleted. The extra delete threshold keeps
# a few more segments on disk after they leave the playlist.
HLS_SEGMENT_SECONDS = 2
HLS_LIST_SIZE = 20
HLS_DELETE_THRESHOLD = 4


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


class CameraHealthMonitor:
    """Watch the HLS output for stalled segments and restart ffmpeg.

    ffmpeg can keep its RTSP input open while the camera silently stops
    sending frames, so the old playlist never grows. The newest segment's
    mtime is the cheapest reliable signal that frames are still arriving.
    """

    def __init__(self, stream: "CameraStream") -> None:
        self._stream = stream
        self._task: asyncio.Task | None = None
        self._token: str | None = None
        self._attempts = 0
        self._started_at = time.monotonic()

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self, token: str) -> None:
        self.stop()
        self._token = token
        self._attempts = 0
        self.mark_started()
        self._task = asyncio.create_task(self._run(token))

    def mark_started(self) -> None:
        """Reset the first-segment grace window after a (re)start."""
        self._started_at = time.monotonic()

    def stop(self) -> None:
        task, self._task = self._task, None
        self._token = None
        if task is not None and task is not asyncio.current_task():
            task.cancel()

    async def _run(self, token: str) -> None:
        try:
            while True:
                await asyncio.sleep(HEALTH_CHECK_INTERVAL)
                try:
                    await self.check(token)
                except Exception:
                    logger.warning("Camera health check failed", exc_info=True)
        except asyncio.CancelledError:
            raise

    async def check(self, token: str) -> bool:
        """Return True when fresh segments are still arriving."""
        if self._fresh(token):
            self._attempts = 0
            return True
        self._attempts += 1
        if self._attempts > MAX_HEALTH_RETRIES:
            # Give up on rapid retries and fall back to one restart a minute.
            self._attempts = 0
            await asyncio.sleep(HEALTH_RETRY_INTERVAL)
        await self._stream.restart()
        return False

    def _fresh(self, token: str) -> bool:
        try:
            newest = max(
                (p.stat().st_mtime for p in output_dir(token).glob("seg_*.ts")),
                default=0.0,
            )
        except OSError:
            # A transient filesystem blip is not a camera failure.
            return True
        if newest == 0.0:
            # Startup owns the first segment timeout. After that, no segments
            # at all means ffmpeg died or its output was removed: restart even
            # though there is no mtime to compare. A dead process is always a
            # stall, so recovery does not wait for the grace window.
            if not self._stream.is_running:
                return False
            return time.monotonic() - self._started_at <= HEALTH_STALL_THRESHOLD
        return time.time() - newest <= HEALTH_STALL_THRESHOLD


class CameraStream:
    """Owns this worker's ffmpeg process and the shared HLS lock."""

    def __init__(self) -> None:
        self._lock: asyncio.Lock | None = None
        self._lock_loop: asyncio.AbstractEventLoop | None = None
        self._process: asyncio.subprocess.Process | None = None
        self._source: str | None = None
        self._token: str | None = None
        self._refresh_task: asyncio.Task | None = None
        self._owner_refreshed_at = 0.0
        self._health_monitor = CameraHealthMonitor(self)

    @property
    def is_running(self) -> bool:
        """True while this worker's ffmpeg process is alive."""
        return self._process is not None and self._process.returncode is None

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
                await self._maybe_refresh_owner()
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
                self._owner_refreshed_at = time.monotonic()

            # We own the lock. Restart if the source changed or ffmpeg died.
            if not running or self._source != source:
                # Keep the election key while ffmpeg is torn down and rebuilt.
                # Releasing it first lets another worker claim ownership and
                # start a second ffmpeg against the same camera. A freshly
                # claimed key already has a full TTL, so only an existing
                # owner needs the longer restart lease.
                if owner == WORKER_ID:
                    await self._lease_restart(redis)

                await self._stop_locked(keep_owner=True)
                try:
                    await self._start_locked(source, token)
                except Exception:
                    await self._stop_locked()
                    raise
                try:
                    await redis.set(OWNER_KEY, WORKER_ID, ex=LOCK_TTL_SECONDS)
                except Exception as exc:
                    await self._stop_locked()
                    raise CameraError("Camera streaming is unavailable.", 503) from exc
                self._owner_refreshed_at = time.monotonic()
                self._refresh_task = asyncio.create_task(self._keep_ownership(source))
                self._health_monitor.start(token)
            return output_dir(token)

    async def _lease_restart(self, redis) -> None:
        """Extend the election lease so a restart never overlaps another owner."""
        failed = False
        try:
            await redis.set(OWNER_KEY, WORKER_ID, ex=RESTART_LOCK_TTL_SECONDS)
        except Exception as exc:
            failed = True
            raise CameraError("Camera streaming is unavailable.", 503) from exc
        finally:
            # Run cleanup even while the CameraError above propagates.
            if failed:
                await self._stop_locked()
        self._owner_refreshed_at = time.monotonic()

    async def _refresh_owner(self) -> None:
        try:
            redis = await get_redis()
            await redis.expire(OWNER_KEY, LOCK_TTL_SECONDS)
            self._owner_refreshed_at = time.monotonic()
        except Exception:
            logger.warning("Could not refresh camera stream ownership", exc_info=True)

    async def _maybe_refresh_owner(self) -> None:
        """Renew the election at most once per ``OWNER_REFRESH_INTERVAL``.

        Every viewer polls the playlist every few seconds. Renewing Redis on
        each of those requests is pointless because ``_keep_ownership`` already
        renews well inside the TTL; throttling keeps many viewers cheap.
        """
        if time.monotonic() - self._owner_refreshed_at < OWNER_REFRESH_INTERVAL:
            return
        await self._refresh_owner()

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

    async def _start_locked(
        self, source: str, token: str, keep_monitor: bool = False
    ) -> None:
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
            f"scale={VIDEO_WIDTH}:{VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,"
            f"pad={VIDEO_WIDTH}:{VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2",
            "-r",
            str(VIDEO_FPS),
            "-g",
            str(VIDEO_FPS * HLS_SEGMENT_SECONDS),
            "-b:v",
            VIDEO_BITRATE,
            "-maxrate",
            VIDEO_BITRATE,
            "-bufsize",
            VIDEO_BUFSIZE,
            "-f",
            "hls",
            "-hls_time",
            str(HLS_SEGMENT_SECONDS),
            "-hls_list_size",
            str(HLS_LIST_SIZE),
            "-hls_delete_threshold",
            str(HLS_DELETE_THRESHOLD),
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
            await self._stop_locked(keep_monitor=keep_monitor)
            if detail:
                raise CameraError(f"{exc} ffmpeg: {detail}") from exc
            raise

    async def restart(self) -> None:
        """Restart ffmpeg for the current source, keeping the health monitor."""
        async with self._get_lock():
            source = self._source
            token = self._token
            if not source or not token:
                return

            # The election may have moved to another worker while this one was
            # unhealthy. Never start a competing ffmpeg in that case: just
            # stop the local process and let the new owner serve viewers.
            redis = None
            try:
                redis = await get_redis()
                owner = _as_text(await redis.get(OWNER_KEY))
            except Exception:
                logger.warning(
                    "Could not check camera stream ownership", exc_info=True
                )
                owner = WORKER_ID
            if owner not in (None, WORKER_ID):
                await self._stop_locked(keep_owner=True)
                return

            if redis is not None:
                try:
                    await redis.set(
                        OWNER_KEY, WORKER_ID, ex=RESTART_LOCK_TTL_SECONDS
                    )
                    self._owner_refreshed_at = time.monotonic()
                except Exception:
                    logger.warning(
                        "Could not reclaim camera stream ownership", exc_info=True
                    )

            await self._stop_locked(keep_monitor=True, keep_owner=True)
            try:
                await self._start_locked(source, token, keep_monitor=True)
            except Exception:
                await self._stop_locked(keep_monitor=True)
                raise
            self._health_monitor.mark_started()
            if redis is not None:
                try:
                    await redis.set(OWNER_KEY, WORKER_ID, ex=LOCK_TTL_SECONDS)
                    self._owner_refreshed_at = time.monotonic()
                except Exception:
                    logger.warning(
                        "Could not reclaim camera stream ownership", exc_info=True
                    )
            self._refresh_task = asyncio.create_task(self._keep_ownership(source))

    async def _keep_ownership(self, source: str) -> None:
        while True:
            await asyncio.sleep(REFRESH_SECONDS)
            if self._source != source:
                return
            try:
                redis = await get_redis()
                owner = _as_text(await redis.get(OWNER_KEY))
                if owner != WORKER_ID:
                    # Handoff: keep the shared key and output while stopping,
                    # otherwise this worker would delete the new owner's files.
                    async with self._get_lock():
                        await self._stop_locked(keep_owner=True)
                    return
                await redis.expire(OWNER_KEY, LOCK_TTL_SECONDS)
                self._owner_refreshed_at = time.monotonic()
            except Exception:
                logger.warning("Could not refresh camera stream ownership", exc_info=True)

    async def stop(self) -> None:
        async with self._get_lock():
            await self._stop_locked()

    async def _stop_locked(
        self, keep_monitor: bool = False, keep_owner: bool = False
    ) -> None:
        """Stop this worker's ffmpeg.

        ``keep_owner`` leaves the shared output directory and the Redis
        election key untouched, so a restart can rebuild the stream without
        opening a window where another worker starts a competing ffmpeg.
        """
        task = self._refresh_task
        self._refresh_task = None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        if not keep_monitor:
            self._health_monitor.stop()

        process = self._process
        token = self._token
        self._process = None
        self._source = None
        self._token = None
        self._owner_refreshed_at = 0.0

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

        if keep_owner:
            return

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


async def release_camera_stream(force: bool = False) -> None:
    """Stop this worker's ffmpeg and release the shared lock.

    ``force`` removes the election from whichever worker holds it; settings
    changes use it because the PATCH request may land on a non-owner worker.
    A normal shutdown only clears the key when this worker actually owns it.
    """
    try:
        redis = await get_redis()
        owner = _as_text(await redis.get(OWNER_KEY))
        if force or owner == WORKER_ID:
            await redis.delete(OWNER_KEY)
    except Exception:
        logger.warning("Could not release camera stream lock", exc_info=True)
    await camera_stream.stop()


async def shutdown_camera_stream() -> None:
    await release_camera_stream()
