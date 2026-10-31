"""Tests for the RTSP -> HLS camera bridge and its HTTP endpoints."""

import asyncio
from pathlib import Path

import pytest
import pytest_asyncio

from app import camera
from app.models.all import Household

DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000000"


class FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}
        self.fail_get = False
        self.fail_set = False
        self.fail_expire = False
        self.fail_delete = False

    async def get(self, key):
        if self.fail_get:
            raise RuntimeError("redis down")
        return self.data.get(key)

    async def set(self, key, value, nx=False, ex=None):
        if self.fail_set:
            raise RuntimeError("redis down")
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True

    async def expire(self, key, ttl):
        if self.fail_expire:
            raise RuntimeError("redis down")
        return True

    async def delete(self, key):
        if self.fail_delete:
            raise RuntimeError("redis down")
        self.data.pop(key, None)
        return 1


class FakeProcess:
    def __init__(self, returncode=None, slow=False) -> None:
        self.returncode = returncode
        self.slow = slow
        self.terminated = False
        self.killed = False

    def terminate(self):
        self.terminated = True
        if not self.slow:
            self.returncode = 0

    def kill(self):
        self.killed = True
        self.returncode = -9

    async def wait(self):
        if self.slow and not self.killed:
            await asyncio.sleep(10)
        if self.returncode is None:
            self.returncode = 0
        return self.returncode


@pytest.fixture
def redis(monkeypatch):
    fake = FakeRedis()

    async def get_redis():
        return fake

    monkeypatch.setattr(camera, "get_redis", get_redis)
    return fake


@pytest_asyncio.fixture
async def camera_root(redis, monkeypatch, tmp_path):
    root = tmp_path / "camera"
    monkeypatch.setattr(camera, "CAMERA_ROOT", root)
    # The stream singleton is module state; each test starts clean.
    stream = camera.camera_stream
    stream._process = None
    stream._source = None
    stream._token = None
    stream._refresh_task = None
    stream._lock = None
    stream._lock_loop = None
    yield root
    await stream.stop()
    stream._process = None
    stream._source = None
    stream._token = None
    stream._refresh_task = None


@pytest.fixture
def ffmpeg(monkeypatch):
    monkeypatch.setattr(camera.shutil, "which", lambda name: "/usr/bin/ffmpeg")


def _write_playlist(token: str, text: str = "#EXTM3U\n") -> Path:
    directory = camera.output_dir(token)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / camera.PLAYLIST_NAME
    path.write_text(text, encoding="utf-8")
    return path


def _fake_process_factory(process, *, write_playlist=True):
    async def create(*args, **kwargs):
        if write_playlist:
            playlist = Path(args[-1])
            playlist.parent.mkdir(parents=True, exist_ok=True)
            playlist.write_text("#EXTM3U\n", encoding="utf-8")
        return process

    return create


CAMERA = {"url": "rtsp://192.168.1.20:554/stream1", "username": "admin", "password": "s3cret"}


# ── URL and settings helpers ─────────────────────────────────────────────────


def test_build_stream_url_empty_and_none():
    assert camera.build_stream_url(None) is None
    assert camera.build_stream_url({}) is None
    assert camera.build_stream_url({"url": "   "}) is None


def test_build_stream_url_rejects_bad_scheme():
    with pytest.raises(camera.CameraError) as exc:
        camera.build_stream_url({"url": "ftp://camera/stream"})
    assert exc.value.status_code == 422


def test_build_stream_url_rejects_bad_port_and_host():
    with pytest.raises(camera.CameraError):
        camera.build_stream_url({"url": "rtsp://camera:notaport/stream"})
    with pytest.raises(camera.CameraError):
        camera.build_stream_url({"url": "rtsp:///stream"})


def test_build_stream_url_rejects_too_long_values():
    with pytest.raises(camera.CameraError):
        camera.build_stream_url({"url": "rtsp://camera/" + "a" * camera.MAX_URL_LENGTH})
    with pytest.raises(camera.CameraError):
        camera.build_stream_url(
            {
                "url": "rtsp://camera/stream",
                "username": "a" * (camera.MAX_CREDENTIAL_LENGTH + 1),
            }
        )


def test_build_stream_url_inserts_encoded_credentials():
    url = camera.build_stream_url(CAMERA)
    assert url == "rtsp://admin:s3cret@192.168.1.20:554/stream1"

    url = camera.build_stream_url(
        {
            "url": "rtsp://[::1]:554/stream",
            "username": "user name",
            "password": "p@ss:word",
        }
    )
    assert url == "rtsp://user%20name:p%40ss%3Aword@[::1]:554/stream"


def test_build_stream_url_without_username_keeps_url():
    assert camera.build_stream_url({"url": "rtsp://camera/stream"}) == "rtsp://camera/stream"


def test_camera_token_and_stream_path():
    source = camera.build_stream_url(CAMERA)
    token = camera.camera_token(source)
    assert len(token) == 16
    assert camera.camera_stream_path(CAMERA) == (
        f"/api/v1/camera/hls/{token}/{camera.PLAYLIST_NAME}"
    )
    assert camera.camera_stream_path(None) is None
    assert camera.camera_stream_path({"url": "bad"}) is None


def test_public_camera_settings_never_includes_password():
    public = camera.public_camera_settings(CAMERA)
    assert public is not None
    assert "password" not in public
    assert public["passwordSet"] is True
    assert public["username"] == "admin"
    assert public["rotation"] == 0
    assert public["streamPath"]

    assert camera.public_camera_settings(None) is None
    plain = camera.public_camera_settings({"url": "rtsp://camera/stream"})
    assert plain["passwordSet"] is False
    assert plain["rotation"] == 0
    assert camera.public_camera_settings({"url": "rtsp://camera/stream", "rotation": 270})["rotation"] == 270
    assert camera.public_camera_settings({"url": "rtsp://camera/stream", "rotation": 45})["rotation"] == 0


def test_merge_camera_settings():
    assert camera.merge_camera_settings(None) is None
    assert camera.merge_camera_settings({"url": "  "}) is None

    with pytest.raises(camera.CameraError):
        camera.merge_camera_settings("not a dict")

    with pytest.raises(camera.CameraError):
        camera.merge_camera_settings({"url": "nope://camera"})

    existing = {"url": "rtsp://camera/old", "username": "u", "password": "old"}
    merged = camera.merge_camera_settings(
        {"url": "rtsp://camera/new", "username": "  admin  "}, existing
    )
    assert merged == {
        "url": "rtsp://camera/new",
        "username": "admin",
        "password": "old",
        "rotation": 0,
    }

    merged = camera.merge_camera_settings(
        {"url": "rtsp://camera/new", "rotation": 90}, existing
    )
    assert merged["rotation"] == 90

    with pytest.raises(camera.CameraError):
        camera.merge_camera_settings({"url": "rtsp://camera/new", "rotation": 45})
    with pytest.raises(camera.CameraError):
        camera.merge_camera_settings({"url": "rtsp://camera/new", "rotation": "sideways"})

    merged = camera.merge_camera_settings({"url": "rtsp://camera/new", "password": "new"}, existing)
    assert merged["password"] == "new"

    merged = camera.merge_camera_settings(
        {"url": "rtsp://camera/new", "password": "new", "clearPassword": True}, existing
    )
    assert merged["password"] == ""


def test_as_text_handles_bytes_and_other_values():
    assert camera._as_text(b"owner") == "owner"
    assert camera._as_text("owner") == "owner"
    assert camera._as_text(None) is None


def test_read_ffmpeg_log_redacts_credentials(tmp_path):
    source = "rtsp://admin:s3cret@192.168.1.20:554/stream1"
    (tmp_path / "ffmpeg.log").write_text(
        f"Opening {source}\n401 Unauthorized\n", encoding="utf-8"
    )
    assert camera._read_ffmpeg_log(tmp_path, source) == "401 Unauthorized"
    assert camera._read_ffmpeg_log(tmp_path / "missing", source) == ""


def test_read_ffmpeg_log_returns_empty_for_blank_output(tmp_path):
    (tmp_path / "ffmpeg.log").write_text("\n  \n", encoding="utf-8")
    assert camera._read_ffmpeg_log(tmp_path, "source") == ""


# ── CameraStream ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ensure_without_url_raises(camera_root, redis):
    with pytest.raises(camera.CameraError) as exc:
        await camera.camera_stream.ensure(None)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_ensure_without_ffmpeg_raises(camera_root, redis, monkeypatch):
    monkeypatch.setattr(camera.shutil, "which", lambda name: None)
    with pytest.raises(camera.CameraError) as exc:
        await camera.camera_stream.ensure(CAMERA)
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_ensure_starts_stream_and_stop_cleans_up(
    camera_root, redis, ffmpeg, monkeypatch
):
    process = FakeProcess()
    monkeypatch.setattr(
        camera.asyncio, "create_subprocess_exec", _fake_process_factory(process)
    )

    directory = await camera.camera_stream.ensure(CAMERA)
    token = camera.camera_token(camera.build_stream_url(CAMERA))
    assert directory == camera.output_dir(token)
    assert (directory / camera.PLAYLIST_NAME).is_file()
    assert redis.data[camera.OWNER_KEY] == camera.WORKER_ID
    assert camera.camera_stream._refresh_task is not None

    # A second request for the same source only refreshes the lock.
    again = await camera.camera_stream.ensure(CAMERA)
    assert again == directory

    await camera.camera_stream.stop()
    assert process.terminated is True
    assert not directory.exists()
    assert camera.OWNER_KEY not in redis.data
    assert camera.camera_stream._refresh_task is None


@pytest.mark.asyncio
async def test_ensure_waits_for_another_worker(camera_root, redis):
    token = camera.camera_token(camera.build_stream_url(CAMERA))
    redis.data[camera.OWNER_KEY] = "other-worker"
    _write_playlist(token)

    directory = await camera.camera_stream.ensure(CAMERA)
    assert directory == camera.output_dir(token)
    assert camera.camera_stream._process is None


@pytest.mark.asyncio
async def test_ensure_waits_for_another_worker_timeout(camera_root, redis, monkeypatch):
    monkeypatch.setattr(camera, "START_TIMEOUT", 0.01)
    monkeypatch.setattr(camera, "POLL_INTERVAL", 0.001)
    redis.data[camera.OWNER_KEY] = "other-worker"

    with pytest.raises(camera.CameraError) as exc:
        await camera.camera_stream.ensure(CAMERA)
    assert exc.value.status_code == 502


@pytest.mark.asyncio
async def test_wait_for_playlist_ignores_a_racing_stat_error(camera_root, monkeypatch):
    monkeypatch.setattr(camera, "START_TIMEOUT", 0.01)
    monkeypatch.setattr(camera, "POLL_INTERVAL", 0.001)

    class BrokenPath:
        def is_file(self):
            raise OSError("gone")

    monkeypatch.setattr(camera, "playlist_path", lambda token: BrokenPath())
    with pytest.raises(camera.CameraError):
        await camera.camera_stream._wait_for_playlist("token")


@pytest.mark.asyncio
async def test_ensure_claim_race_waits_for_playlist(camera_root, redis, monkeypatch):
    token = camera.camera_token(camera.build_stream_url(CAMERA))
    original_set = redis.set

    async def lose_race(key, value, nx=False, ex=None):
        redis.data[key] = "other-worker"
        return None

    redis.set = lose_race
    _write_playlist(token)
    directory = await camera.camera_stream.ensure(CAMERA)
    assert directory == camera.output_dir(token)
    redis.set = original_set


@pytest.mark.asyncio
async def test_ensure_redis_failure(camera_root, redis):
    redis.fail_get = True
    with pytest.raises(camera.CameraError) as exc:
        await camera.camera_stream.ensure(CAMERA)
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_ensure_failure_to_refresh_lock_stops_stream(
    camera_root, redis, ffmpeg, monkeypatch
):
    process = FakeProcess()
    monkeypatch.setattr(
        camera.asyncio, "create_subprocess_exec", _fake_process_factory(process)
    )
    calls = 0
    original_set = redis.set

    async def fail_second_set(key, value, nx=False, ex=None):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("redis down")
        return await original_set(key, value, nx=nx, ex=ex)

    redis.set = fail_second_set
    with pytest.raises(camera.CameraError) as exc:
        await camera.camera_stream.ensure(CAMERA)
    assert exc.value.status_code == 503
    assert process.terminated is True


@pytest.mark.asyncio
async def test_ensure_restarts_when_source_changes(camera_root, redis, ffmpeg, monkeypatch):
    processes = [FakeProcess(), FakeProcess()]
    monkeypatch.setattr(
        camera.asyncio,
        "create_subprocess_exec",
        _fake_process_factory(processes[0]),
    )
    await camera.camera_stream.ensure(CAMERA)

    monkeypatch.setattr(
        camera.asyncio,
        "create_subprocess_exec",
        _fake_process_factory(processes[1]),
    )
    await camera.camera_stream.ensure({**CAMERA, "url": "rtsp://camera/other"})
    assert processes[0].terminated is True
    assert processes[1].terminated is False


@pytest.mark.asyncio
async def test_ensure_restarts_when_process_exited(camera_root, redis, ffmpeg, monkeypatch):
    first = FakeProcess()
    second = FakeProcess()
    monkeypatch.setattr(
        camera.asyncio, "create_subprocess_exec", _fake_process_factory(first)
    )
    await camera.camera_stream.ensure(CAMERA)
    first.returncode = 1

    monkeypatch.setattr(
        camera.asyncio, "create_subprocess_exec", _fake_process_factory(second)
    )
    await camera.camera_stream.ensure(CAMERA)
    assert camera.camera_stream._process is second


@pytest.mark.asyncio
async def test_start_fails_when_process_exits(camera_root, redis, ffmpeg, monkeypatch):
    process = FakeProcess(returncode=1)
    monkeypatch.setattr(
        camera.asyncio,
        "create_subprocess_exec",
        _fake_process_factory(process, write_playlist=False),
    )
    with pytest.raises(camera.CameraError):
        await camera.camera_stream.ensure(CAMERA)


@pytest.mark.asyncio
async def test_start_times_out(camera_root, redis, ffmpeg, monkeypatch):
    monkeypatch.setattr(camera, "START_TIMEOUT", 0.01)
    monkeypatch.setattr(camera, "POLL_INTERVAL", 0.001)
    process = FakeProcess()
    monkeypatch.setattr(
        camera.asyncio,
        "create_subprocess_exec",
        _fake_process_factory(process, write_playlist=False),
    )
    with pytest.raises(camera.CameraError):
        await camera.camera_stream.ensure(CAMERA)


@pytest.mark.asyncio
async def test_start_subprocess_oserror(camera_root, redis, ffmpeg, monkeypatch):
    async def fail(*args, **kwargs):
        raise OSError("no ffmpeg")

    monkeypatch.setattr(camera.asyncio, "create_subprocess_exec", fail)
    monkeypatch.setattr(camera, "_read_ffmpeg_log", lambda directory, source: "permission denied")
    with pytest.raises(camera.CameraError) as exc:
        await camera.camera_stream.ensure(CAMERA)
    assert exc.value.status_code == 503
    assert "permission denied" in str(exc.value)


@pytest.mark.asyncio
async def test_start_failure_includes_ffmpeg_detail(camera_root, redis, ffmpeg, monkeypatch):
    process = FakeProcess(returncode=1)
    monkeypatch.setattr(
        camera.asyncio,
        "create_subprocess_exec",
        _fake_process_factory(process, write_playlist=False),
    )
    monkeypatch.setattr(camera, "_read_ffmpeg_log", lambda directory, source: "401 Unauthorized")
    with pytest.raises(camera.CameraError) as exc:
        await camera.camera_stream.ensure(CAMERA)
    assert "401 Unauthorized" in str(exc.value)


@pytest.mark.asyncio
async def test_stop_kills_a_process_that_will_not_terminate(camera_root, redis, monkeypatch):
    monkeypatch.setattr(camera, "STOP_TIMEOUT", 0.01)
    process = FakeProcess(slow=True)
    camera.camera_stream._process = process
    camera.camera_stream._token = "abc"
    camera.camera_stream._source = "source"
    await camera.camera_stream.stop()
    assert process.killed is True


@pytest.mark.asyncio
async def test_stop_skips_an_already_exited_process(camera_root, redis):
    process = FakeProcess(returncode=0)
    camera.camera_stream._process = process
    camera.camera_stream._token = "abc"
    await camera.camera_stream.stop()
    assert process.terminated is False


@pytest.mark.asyncio
async def test_stop_ignores_process_lookup_errors(camera_root, redis, monkeypatch):
    class Gone(FakeProcess):
        def terminate(self):
            raise ProcessLookupError

        def kill(self):
            raise ProcessLookupError

        async def wait(self):
            raise ProcessLookupError

    camera.camera_stream._process = Gone(returncode=None)
    camera.camera_stream._token = "abc"
    monkeypatch.setattr(camera, "STOP_TIMEOUT", 0.01)
    await camera.camera_stream.stop()


@pytest.mark.asyncio
async def test_stop_logs_redis_failures(camera_root, redis):
    redis.fail_get = True
    await camera.camera_stream.stop()


@pytest.mark.asyncio
async def test_refresh_owner_logs_redis_failure(redis):
    redis.fail_expire = True
    await camera.camera_stream._refresh_owner()


@pytest.mark.asyncio
async def test_keep_ownership_stops_when_lock_is_lost(
    camera_root, redis, ffmpeg, monkeypatch
):
    monkeypatch.setattr(camera, "REFRESH_SECONDS", 0)
    process = FakeProcess()
    monkeypatch.setattr(
        camera.asyncio, "create_subprocess_exec", _fake_process_factory(process)
    )
    await camera.camera_stream.ensure(CAMERA)

    redis.data[camera.OWNER_KEY] = "someone-else"
    task = camera.camera_stream._refresh_task
    assert task is not None
    await asyncio.wait_for(task, timeout=1)
    assert process.terminated is True


@pytest.mark.asyncio
async def test_keep_ownership_refreshes_lock_and_exits_on_source_change(
    camera_root, redis, ffmpeg, monkeypatch
):
    monkeypatch.setattr(camera, "REFRESH_SECONDS", 0)
    process = FakeProcess()
    monkeypatch.setattr(
        camera.asyncio, "create_subprocess_exec", _fake_process_factory(process)
    )
    await camera.camera_stream.ensure(CAMERA)

    original_expire = redis.expire

    async def expire_and_stop(key, ttl):
        await original_expire(key, ttl)
        camera.camera_stream._source = None
        return True

    redis.expire = expire_and_stop
    task = camera.camera_stream._refresh_task
    assert task is not None
    await asyncio.wait_for(task, timeout=1)


@pytest.mark.asyncio
async def test_keep_ownership_logs_redis_errors_then_exits(
    camera_root, redis, ffmpeg, monkeypatch
):
    monkeypatch.setattr(camera, "REFRESH_SECONDS", 0)
    process = FakeProcess()
    monkeypatch.setattr(
        camera.asyncio, "create_subprocess_exec", _fake_process_factory(process)
    )
    await camera.camera_stream.ensure(CAMERA)

    original_get = redis.get
    calls = 0

    async def fail_once(key):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("redis down")
        camera.camera_stream._source = None
        return await original_get(key)

    redis.get = fail_once
    task = camera.camera_stream._refresh_task
    assert task is not None
    await asyncio.wait_for(task, timeout=1)


@pytest.mark.asyncio
async def test_release_camera_stream_clears_lock_and_stops(camera_root, redis, ffmpeg, monkeypatch):
    process = FakeProcess()
    monkeypatch.setattr(
        camera.asyncio, "create_subprocess_exec", _fake_process_factory(process)
    )
    await camera.camera_stream.ensure(CAMERA)
    await camera.release_camera_stream()
    assert process.terminated is True
    assert camera.OWNER_KEY not in redis.data


@pytest.mark.asyncio
async def test_release_camera_stream_survives_redis_failure(camera_root, redis):
    redis.fail_delete = True
    await camera.release_camera_stream()


@pytest.mark.asyncio
async def test_shutdown_camera_stream(camera_root, redis):
    await camera.shutdown_camera_stream()


# ── Router ───────────────────────────────────────────────────────────────────


async def _seed_camera(db_session, camera_settings):
    db_session.add(
        Household(
            id=DEFAULT_HOUSEHOLD_ID,
            name="Home",
            settings={"camera": camera_settings} if camera_settings is not None else {},
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_playlist_rejects_unknown_token(client):
    r = await client.get("/api/v1/camera/hls/not-a-token/index.m3u8")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_playlist_without_household(client):
    r = await client.get("/api/v1/camera/hls/0123456789abcdef/index.m3u8")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_playlist_without_camera(client, db_session):
    await _seed_camera(db_session, None)
    r = await client.get("/api/v1/camera/hls/0123456789abcdef/index.m3u8")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_playlist_rejects_a_stale_token(client, db_session):
    await _seed_camera(db_session, CAMERA)
    r = await client.get("/api/v1/camera/hls/0123456789abcdef/index.m3u8")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_playlist_rejects_invalid_stored_camera(client, db_session):
    await _seed_camera(db_session, {"url": "not-a-url"})
    token = "0123456789abcdef"
    r = await client.get(f"/api/v1/camera/hls/{token}/index.m3u8")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_playlist_serves_the_file(client, db_session, camera_root, monkeypatch):
    await _seed_camera(db_session, CAMERA)
    token = camera.camera_token(camera.build_stream_url(CAMERA))
    _write_playlist(token)

    async def ensure(settings):
        return camera.output_dir(token)

    monkeypatch.setattr(camera.camera_stream, "ensure", ensure)
    r = await client.get(f"/api/v1/camera/hls/{token}/index.m3u8")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.apple.mpegurl")
    assert r.text.startswith("#EXTM3U")


@pytest.mark.asyncio
async def test_playlist_maps_camera_errors(client, db_session, camera_root, monkeypatch):
    await _seed_camera(db_session, CAMERA)
    token = camera.camera_token(camera.build_stream_url(CAMERA))

    async def fail(settings):
        raise camera.CameraError("ffmpeg missing", 503)

    monkeypatch.setattr(camera.camera_stream, "ensure", fail)
    r = await client.get(f"/api/v1/camera/hls/{token}/index.m3u8")
    assert r.status_code == 503
    assert r.json()["detail"] == "ffmpeg missing"


@pytest.mark.asyncio
async def test_playlist_404_when_ensure_returns_no_file(
    client, db_session, camera_root, monkeypatch
):
    await _seed_camera(db_session, CAMERA)
    token = camera.camera_token(camera.build_stream_url(CAMERA))

    async def ensure(settings):
        return camera.output_dir(token)

    monkeypatch.setattr(camera.camera_stream, "ensure", ensure)
    r = await client.get(f"/api/v1/camera/hls/{token}/index.m3u8")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_segment_rejects_bad_names(client):
    token = "0123456789abcdef"
    assert (await client.get(f"/api/v1/camera/hls/{token}/../secret")).status_code == 404
    assert (await client.get(f"/api/v1/camera/hls/{token}/index.m3u8")).status_code == 404
    assert (await client.get("/api/v1/camera/hls/nope/seg_000001.ts")).status_code == 404


@pytest.mark.asyncio
async def test_segment_requires_a_matching_camera(client, db_session):
    await _seed_camera(db_session, None)
    token = "0123456789abcdef"
    assert (await client.get(f"/api/v1/camera/hls/{token}/seg_000001.ts")).status_code == 404

    await db_session.delete(await db_session.get(Household, DEFAULT_HOUSEHOLD_ID))
    await db_session.commit()
    assert (await client.get(f"/api/v1/camera/hls/{token}/seg_000001.ts")).status_code == 404


@pytest.mark.asyncio
async def test_segment_rejects_invalid_stored_camera(client, db_session):
    await _seed_camera(db_session, {"url": "nope://camera"})
    token = "0123456789abcdef"
    r = await client.get(f"/api/v1/camera/hls/{token}/seg_000001.ts")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_segment_serves_the_file(client, db_session, camera_root):
    await _seed_camera(db_session, CAMERA)
    token = camera.camera_token(camera.build_stream_url(CAMERA))
    directory = camera.output_dir(token)
    directory.mkdir(parents=True)
    (directory / "seg_000001.ts").write_bytes(b"segment")
    r = await client.get(f"/api/v1/camera/hls/{token}/seg_000001.ts")
    assert r.status_code == 200
    assert r.headers["content-type"] == "video/mp2t"
    assert r.content == b"segment"


@pytest.mark.asyncio
async def test_segment_404_when_file_is_missing(client, db_session, camera_root):
    await _seed_camera(db_session, CAMERA)
    token = camera.camera_token(camera.build_stream_url(CAMERA))
    r = await client.get(f"/api/v1/camera/hls/{token}/seg_000001.ts")
    assert r.status_code == 404


# ── Camera settings ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_camera_settings_are_masked_and_path_is_exposed(client, db_session):
    r = await client.patch("/api/v1/household/settings", json={"settings": {"camera": CAMERA}})
    assert r.status_code == 200
    payload = r.json()["settings"]["camera"]
    assert "password" not in payload
    assert payload["passwordSet"] is True
    assert payload["streamPath"] == camera.camera_stream_path(CAMERA)

    r = await client.get("/api/v1/household/settings")
    assert r.json()["camera"] == payload


@pytest.mark.asyncio
async def test_camera_password_is_preserved_when_omitted(client, db_session):
    await client.patch("/api/v1/household/settings", json={"settings": {"camera": CAMERA}})
    r = await client.patch(
        "/api/v1/household/settings",
        json={"settings": {"camera": {"url": CAMERA["url"], "username": "viewer"}}},
    )
    assert r.json()["settings"]["camera"]["passwordSet"] is True

    stored = (await db_session.get(Household, DEFAULT_HOUSEHOLD_ID)).settings["camera"]
    assert stored["password"] == "s3cret"
    assert stored["username"] == "viewer"


@pytest.mark.asyncio
async def test_camera_password_can_be_cleared(client, db_session):
    await client.patch("/api/v1/household/settings", json={"settings": {"camera": CAMERA}})
    r = await client.patch(
        "/api/v1/household/settings",
        json={"settings": {"camera": {**CAMERA, "clearPassword": True}}},
    )
    assert r.json()["settings"]["camera"]["passwordSet"] is False


@pytest.mark.asyncio
async def test_camera_can_be_removed(client, db_session):
    await client.patch("/api/v1/household/settings", json={"settings": {"camera": CAMERA}})
    r = await client.patch("/api/v1/household/settings", json={"settings": {"camera": None}})
    assert r.json()["settings"]["camera"] is None
    assert (await db_session.get(Household, DEFAULT_HOUSEHOLD_ID)).settings.get("camera") is None


@pytest.mark.asyncio
async def test_camera_rotation_is_saved(client, db_session):
    r = await client.patch(
        "/api/v1/household/settings",
        json={"settings": {"camera": {**CAMERA, "rotation": 270}}},
    )
    assert r.status_code == 200
    assert r.json()["settings"]["camera"]["rotation"] == 270
    stored = (await db_session.get(Household, DEFAULT_HOUSEHOLD_ID)).settings["camera"]
    assert stored["rotation"] == 270


@pytest.mark.asyncio
async def test_camera_rejects_invalid_settings(client, db_session):
    r = await client.patch(
        "/api/v1/household/settings", json={"settings": {"camera": {"url": "ftp://camera"}}}
    )
    assert r.status_code == 422
    assert "rtsp://" in r.json()["detail"]

    r = await client.patch(
        "/api/v1/household/settings",
        json={"settings": {"camera": {**CAMERA, "rotation": 45}}},
    )
    assert r.status_code == 422
    assert "rotation" in r.json()["detail"]


@pytest.mark.asyncio
async def test_camera_change_releases_the_stream(client, db_session, monkeypatch):
    released = []

    async def release():
        released.append(True)

    monkeypatch.setattr("app.routers.settings.release_camera_stream", release)
    r = await client.patch("/api/v1/household/settings", json={"settings": {"camera": CAMERA}})
    assert r.status_code == 200
    assert released == [True]

    # Unrelated settings must not tear down the camera stream.
    await client.patch("/api/v1/household/settings", json={"settings": {"theme": "dark"}})
    assert released == [True]


@pytest.mark.asyncio
async def test_settings_broadcast_masks_the_camera_password(client, db_session, monkeypatch):
    published = []

    async def publish(household_id, event, data):
        published.append(data)

    monkeypatch.setattr("app.routers.settings.publish_event", publish)
    await client.patch("/api/v1/household/settings", json={"settings": {"camera": CAMERA}})
    assert published[-1]["settings"]["camera"]["passwordSet"] is True
    assert "password" not in published[-1]["settings"]["camera"]
