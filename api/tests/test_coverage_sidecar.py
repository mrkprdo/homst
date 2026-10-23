"""Coverage for the Docker client, update manager, and updater sidecar app."""

import copy

import pytest
from fastapi import HTTPException

from app.updater import docker_api
from app.updater import main as updater_main
from app.updater.docker_api import DockerClient, DockerError
from app.updater.job import (
    ConflictError,
    RecoveryError,
    UpdateManager,
    _image_version,
    _is_older,
)
from app.updater.state import StateStore

# ══════════════════════════════════════════════════════════════════════
# updater/docker_api
# ══════════════════════════════════════════════════════════════════════


class _Response:
    def __init__(
        self,
        status_code=200,
        *,
        text="",
        payload=None,
        lines=None,
        body=b"",
    ):
        self.status_code = status_code
        self.text = text
        self._payload = payload
        self._lines = lines or []
        self._body = body
        self.headers = {}

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload

    async def aread(self):
        return self._body

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class _Stream:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self.response

    async def __aexit__(self, *exc):
        return False


class _HTTP:
    def __init__(self, responses=None, error=None):
        self.responses = list(responses or [])
        self.error = error
        self.calls = []
        self.closed = False

    async def request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if self.error:
            raise self.error
        return self.responses.pop(0)

    def stream(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        return _Stream(self.responses.pop(0))

    async def aclose(self):
        self.closed = True


def _client(responses=None, error=None):
    client = object.__new__(DockerClient)
    client._client = _HTTP(responses, error)
    return client, client._client


@pytest.mark.asyncio
async def test_docker_client_request_wraps_transport_and_api_errors():
    client, http = _client(error=RuntimeError("no socket"))
    with pytest.raises(DockerError) as exc:
        await client.ping()
    assert exc.value.status_code == 503

    client, _ = _client([_Response(500, payload={"message": "boom"})])
    with pytest.raises(DockerError) as exc:
        await client.ping()
    assert exc.value.message == "boom"

    client, _ = _client([_Response(500, payload=ValueError("not json"), text="raw")])
    with pytest.raises(DockerError) as exc:
        await client.ping()
    assert exc.value.message == "raw"

    client, http = _client([_Response(200, text="OK")])
    assert await client.ping() is True
    assert http.calls[0][1] == "/_ping"
    await client.close()
    assert http.closed is True


@pytest.mark.asyncio
async def test_docker_client_reads_objects_and_tags_and_creates():
    client, http = _client(
        [
            _Response(200, payload={"Id": "c1"}),
            _Response(200, payload={"Id": "i1"}),
            _Response(200, text=""),
            _Response(200, payload={"Id": "new"}),
        ]
    )
    assert await client.inspect_container("homst") == {"Id": "c1"}
    assert await client.inspect_image("ghcr.io/x/y:1") == {"Id": "i1"}
    await client.tag_image("ghcr.io/x/y:1", "ghcr.io/x/y", "latest")
    assert await client.create_container("homst", {"Image": "x"}) == {"Id": "new"}
    assert "ghcr.io%2Fx%2Fy%3A1" in http.calls[1][1]
    assert docker_api._quote("a/b c") == "a%2Fb%20c"


@pytest.mark.asyncio
async def test_docker_pull_stream_reports_progress_and_errors():
    progress = []
    lines = [
        "",
        "not-json",
        '{"id":"a","progressDetail":{"current":10,"total":100},"status":"Downloading"}',
        '{"id":"b","status":"Pull complete"}',
        '{"id":"c","status":"Waiting"}',
        '{"status":"Done"}',
    ]
    client, _ = _client([_Response(200, lines=lines)])
    await client.pull_image(
        "ghcr.io/x/y", "1", lambda *args: progress.append(args)
    )
    assert progress[-1][1] == 11
    assert progress[-1][2] == 101
    assert progress[-1][3] == "Done"

    client, _ = _client([_Response(200, lines=['{"error":"layer exploded"}'])])
    with pytest.raises(DockerError) as exc:
        await client.pull_image("ghcr.io/x/y", "1")
    assert exc.value.message == "layer exploded"

    client, _ = _client(
        [_Response(400, payload={"message": "denied"}, body=b'{"message":"denied"}')]
    )
    with pytest.raises(DockerError) as exc:
        await client.pull_image("ghcr.io/x/y", "1")
    assert exc.value.message == "denied"

    client, _ = _client([_Response(400, payload=ValueError(), body=b"bad image")])
    with pytest.raises(DockerError) as exc:
        await client.pull_image("ghcr.io/x/y", "1")
    assert exc.value.message == "bad image"


@pytest.mark.asyncio
async def test_docker_container_lifecycle_ignores_benign_statuses():
    client, http = _client(
        [
            _Response(304),  # stop: already stopped
            _Response(404),  # stop: gone
            _Response(200),  # rename
            _Response(304),  # start: already running
            _Response(404),  # remove: gone
        ]
    )
    await client.stop_container("c1")
    await client.stop_container("c2")
    await client.rename_container("c3", "rollback")
    await client.start_container("c4")
    await client.remove_container("c5")

    client, _ = _client([_Response(500, payload={"message": "nope"})])
    with pytest.raises(DockerError):
        await client.stop_container("c1")

    client, _ = _client([_Response(500, payload={"message": "nope"})])
    with pytest.raises(DockerError):
        await client.start_container("c1")

    client, _ = _client([_Response(500, payload={"message": "nope"})])
    with pytest.raises(DockerError):
        await client.remove_container("c1")


@pytest.mark.asyncio
async def test_docker_health_check_reads_exec_exit_code(monkeypatch):
    client, http = _client(
        [
            _Response(200, payload={"Id": "exec-1"}),
            _Response(200, payload={}),
            _Response(200, payload={"Running": False, "ExitCode": 0}),
        ]
    )
    assert await client.health_check("c1") is True

    client, _ = _client(
        [
            _Response(200, payload={"Id": "exec-2"}),
            _Response(200, payload={}),
            _Response(200, payload={"Running": True}),
            _Response(200, payload={"Running": False, "ExitCode": 1}),
        ]
    )

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(docker_api.asyncio, "sleep", no_sleep)
    assert await client.health_check("c1") is False

    client, _ = _client(error=RuntimeError("exec failed"))
    assert await client.health_check("c1") is False


# ══════════════════════════════════════════════════════════════════════
# updater/job helpers and sync
# ══════════════════════════════════════════════════════════════════════


def _image(version=None, image_id="sha256:img", label=None, env=None):
    config = {"Env": env or [], "Labels": {}}
    if version:
        config["Env"] = [f"HOMST_VERSION={version}"]
    if label:
        config["Labels"]["org.opencontainers.image.version"] = label
    return {"Id": image_id, "Config": config}


def _container(version="0.2.0", image_id="sha256:old", image_ref="ghcr.io/mrkprdo/homst:latest"):
    return {
        "Id": "old-id",
        "Name": "/homst",
        "Image": image_id,
        "Config": {
            "Image": image_ref,
            "Env": [f"HOMST_VERSION={version}"] if version else [],
            "Labels": {},
        },
        "HostConfig": {},
        "Mounts": [],
        "State": {"Running": True, "Status": "running"},
    }


def test_job_helper_fallbacks():
    assert _is_older("bad", "0.2.0") is False
    assert _is_older(None, "0.2.0") is False
    assert _is_older("0.1.0", "0.2.0") is True

    assert _image_version(_image(env=["HOMST_VERSION=1.2.3"])) == "1.2.3"
    assert _image_version(_image(label="1.2.4")) == "1.2.4"
    assert _image_version(
        _image(), _container(version="1.2.5")
    ) == "1.2.5"
    assert _image_version(_image(), _container(version=None)) is None


class _SyncDocker:
    def __init__(self, container=None, image=None, image_error=None):
        self.container = container
        self.image = image
        self.image_error = image_error

    async def inspect_container(self, _name):
        if self.container is None:
            raise DockerError(404, "missing")
        return copy.deepcopy(self.container)

    async def inspect_image(self, _ref):
        if self.image_error:
            raise self.image_error
        return copy.deepcopy(self.image or {})


@pytest.mark.asyncio
async def test_sync_current_handles_missing_container_and_image(tmp_path):
    manager = UpdateManager(
        docker=_SyncDocker(), store=StateStore(str(tmp_path)),
        target_name="homst", image_repo="ghcr.io/mrkprdo/homst",
    )
    await manager.sync_current()  # no target

    docker = _SyncDocker(container=_container(), image_error=DockerError(404, "no image"))
    manager = UpdateManager(
        docker=docker, store=StateStore(str(tmp_path)),
        target_name="homst", image_repo="ghcr.io/mrkprdo/homst",
    )
    await manager.sync_current()
    state = await manager.snapshot()
    assert state["current_version"] == "0.2.0"


@pytest.mark.asyncio
async def test_sync_current_clears_stale_and_invalid_holds(tmp_path):
    store = StateStore(str(tmp_path))
    await store.update(held_version="0.2.0", held_reason="failed")
    docker = _SyncDocker(container=_container(), image=_image("0.2.0"))
    manager = UpdateManager(
        docker=docker, store=store, target_name="homst",
        image_repo="ghcr.io/mrkprdo/homst",
    )
    await manager.sync_current()
    state = await manager.snapshot()
    assert state["held_version"] is None

    await store.update(held_version="not-a-version", held_reason="odd")
    await manager.sync_current()
    assert (await manager.snapshot())["held_version"] == "not-a-version"

    docker = _SyncDocker(container=_container(), image=_image("0.2.0"))
    await manager.sync_current()
    # Same version: no redundant state write.
    assert (await manager.snapshot())["current_version"] == "0.2.0"


# ══════════════════════════════════════════════════════════════════════
# updater/job recovery
# ══════════════════════════════════════════════════════════════════════


class _RecoveryDocker:
    def __init__(self, containers=None):
        self.containers = containers or {}
        self.calls = []
        self.fail_start = False

    async def inspect_container(self, name):
        if name in self.containers:
            return copy.deepcopy(self.containers[name])
        for container in self.containers.values():
            if container["Id"] == name:
                return copy.deepcopy(container)
        raise DockerError(404, "missing")

    async def start_container(self, container_id):
        if self.fail_start:
            raise DockerError(500, "cannot start")
        for container in self.containers.values():
            if container["Id"] == container_id:
                container["State"] = {"Running": True, "Status": "running"}
        self.calls.append(("start", container_id))

    async def stop_container(self, container_id):
        self.calls.append(("stop", container_id))

    async def rename_container(self, container_id, name):
        self.calls.append(("rename", container_id, name))

    async def remove_container(self, container_id):
        self.calls.append(("remove", container_id))

    async def tag_image(self, ref, repo, tag):
        self.calls.append(("tag", ref, repo, tag))

    async def inspect_image(self, _ref):
        return _image()

    async def health_check(self, _container_id):
        return True


def _manager(tmp_path, docker):
    return UpdateManager(
        docker=docker,
        store=StateStore(str(tmp_path)),
        target_name="homst",
        image_repo="ghcr.io/mrkprdo/homst",
        health_timeout=0,
    )


@pytest.mark.asyncio
async def test_recover_marks_active_job_failed_without_a_journal(tmp_path, monkeypatch):
    store = StateStore(str(tmp_path))
    await store.update(last_job={"id": "j1", "state": "queued", "version": "0.3.0"})
    manager = _manager(tmp_path, _RecoveryDocker())
    await manager.recover()
    assert (await manager.snapshot())["job"]["state"] == "failed"


@pytest.mark.asyncio
async def test_recover_aborts_download_phase_and_clears_journal(tmp_path):
    store = StateStore(str(tmp_path))
    await store.write_journal(
        {"job_id": "j1", "phase": "pulling", "rollback_name": "rollback"}
    )
    manager = _manager(tmp_path, _RecoveryDocker())
    await manager.recover()
    assert (await manager.snapshot())["job"]["state"] == "failed"
    assert await manager.store.journal() is None


@pytest.mark.asyncio
async def test_recover_restarts_stopped_old_container(tmp_path, monkeypatch):
    docker = _RecoveryDocker({"homst": _container()})
    docker.containers["homst"]["State"] = {"Running": False, "Status": "exited"}
    store = StateStore(str(tmp_path))
    await store.write_journal(
        {
            "job_id": "j1",
            "phase": "stopped",
            "rollback_name": "rollback",
            "old_version": "0.2.0",
            "new_version": "0.3.0",
        }
    )
    manager = _manager(tmp_path, docker)
    await manager.recover()
    state = await manager.snapshot()
    assert state["job"]["state"] == "rolled_back"
    assert state["held_version"] == "0.3.0"
    assert ("start", "old-id") in docker.calls


@pytest.mark.asyncio
async def test_recover_marks_failed_when_old_container_cannot_start(tmp_path):
    docker = _RecoveryDocker({"homst": _container()})
    docker.containers["homst"]["State"] = {"Running": False, "Status": "exited"}
    docker.fail_start = True
    store = StateStore(str(tmp_path))
    await store.write_journal(
        {
            "job_id": "j1",
            "phase": "stopped",
            "rollback_name": "rollback",
            "old_version": "0.2.0",
            "new_version": "0.3.0",
        }
    )
    manager = _manager(tmp_path, docker)
    await manager.recover()
    assert (await manager.snapshot())["job"]["state"] == "failed"


@pytest.mark.asyncio
async def test_recover_finishes_a_healthy_new_container(tmp_path):
    docker = _RecoveryDocker(
        {
            "homst": {
                **_container(),
                "Id": "new-id",
                "State": {"Running": True, "Status": "running"},
            },
            "rollback": {**_container(), "Id": "rollback-id"},
        }
    )
    store = StateStore(str(tmp_path))
    await store.write_journal(
        {
            "job_id": "j1",
            "phase": "verifying",
            "rollback_name": "rollback",
            "old_version": "0.2.0",
            "new_version": "0.3.0",
            "new_image_ref": "ghcr.io/mrkprdo/homst:0.3.0",
            "new_container_id": "new-id",
        }
    )
    manager = _manager(tmp_path, docker)
    await manager.store.update(last_job={"id": "j1", "latest": True})
    await manager.recover()
    state = await manager.snapshot()
    assert state["job"]["state"] == "success"
    assert state["current_version"] == "0.3.0"
    assert ("remove", "rollback-id") in docker.calls
    assert ("tag", "ghcr.io/mrkprdo/homst:0.3.0", "ghcr.io/mrkprdo/homst", "latest") in docker.calls

    # A failed latest retag is only a warning.
    store = StateStore(str(tmp_path / "retag"))
    docker.calls.clear()

    async def fail_tag(*_args):
        raise DockerError(500, "cannot tag")

    docker.tag_image = fail_tag
    await store.write_journal(
        {
            "job_id": "j2",
            "phase": "verifying",
            "rollback_name": "rollback",
            "old_version": "0.2.0",
            "new_version": "0.3.0",
            "new_container_id": "new-id",
        }
    )
    manager = _manager(tmp_path / "retag", docker)
    await manager.store.update(last_job={"id": "j2", "latest": True})
    await manager.recover()
    assert (await manager.snapshot())["job"]["state"] == "success"


@pytest.mark.asyncio
async def test_recover_restores_the_rollback_container(tmp_path):
    docker = _RecoveryDocker(
        {
            "homst": {
                **_container(),
                "Id": "other-id",
                "State": {"Running": True, "Status": "running"},
            },
            "rollback": {**_container(), "Id": "rollback-id"},
        }
    )
    store = StateStore(str(tmp_path))
    await store.write_journal(
        {
            "job_id": "j1",
            "phase": "verifying",
            "rollback_name": "rollback",
            "old_version": "0.2.0",
            "new_version": "0.3.0",
            "new_container_id": "new-id",
        }
    )
    manager = _manager(tmp_path, docker)
    await manager.recover()
    assert (await manager.snapshot())["job"]["state"] == "rolled_back"
    assert ("remove", "other-id") in docker.calls
    assert ("rename", "rollback-id", "homst") in docker.calls


@pytest.mark.asyncio
async def test_recover_reports_unrecoverable_state(tmp_path):
    store = StateStore(str(tmp_path))
    await store.write_journal(
        {
            "job_id": "j1",
            "phase": "renamed",
            "rollback_name": "missing",
            "old_version": "0.2.0",
            "new_version": "0.3.0",
        }
    )
    manager = _manager(tmp_path, _RecoveryDocker())
    await manager.recover()
    assert (await manager.snapshot())["job"]["state"] == "failed"


# ══════════════════════════════════════════════════════════════════════
# updater/job install guards and rollback helper
# ══════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_install_rejects_invalid_versions_and_concurrent_jobs(tmp_path):
    manager = _manager(tmp_path, _RecoveryDocker())
    with pytest.raises(ConflictError):
        await manager.install("latest", latest=False)

    manager._busy = True
    with pytest.raises(ConflictError):
        await manager.install("0.3.0", latest=False)

    manager._busy = False
    manager._job = {"state": "queued"}
    with pytest.raises(ConflictError):
        await manager.install("0.3.0", latest=False)


def test_set_job_is_a_noop_without_a_job(tmp_path):
    manager = _manager(tmp_path, _RecoveryDocker())
    manager._job = None
    manager._set_job(state="queued")
    assert manager._job is None


@pytest.mark.asyncio
async def test_rollback_handles_missing_and_running_old_containers(tmp_path):
    manager = _manager(tmp_path, _RecoveryDocker())
    assert await manager._rollback(None, "missing") is False

    docker = _RecoveryDocker({"old-id": _container()})
    manager = _manager(tmp_path, docker)
    assert await manager._rollback(_container(), "missing") is True

    docker = _RecoveryDocker({"old-id": _container()})
    docker.containers["old-id"]["State"] = {"Running": False, "Status": "exited"}
    manager = _manager(tmp_path, docker)
    assert await manager._rollback(_container(), "missing") is True

    docker = _RecoveryDocker()
    DockerFail = type(
        "DockerFail",
        (_RecoveryDocker,),
        {
            "inspect_container": _raise_docker_error,
        },
    )
    manager = _manager(tmp_path, DockerFail())
    assert await manager._rollback(_container(), "missing") is False

    class Exploding(_RecoveryDocker):
        async def inspect_container(self, name):
            raise RuntimeError("boom")

    manager = _manager(tmp_path, Exploding())
    assert await manager._rollback(_container(), "missing") is False


async def _raise_docker_error(self, _name):
    raise DockerError(404, "missing")


@pytest.mark.asyncio
async def test_retry_rollback_guards_and_success(tmp_path):
    manager = _manager(tmp_path, _RecoveryDocker())

    manager._busy = True
    with pytest.raises(ConflictError):
        await manager.retry_rollback()
    manager._busy = False

    with pytest.raises(ConflictError):
        await manager.retry_rollback()

    store = manager.store
    await store.write_journal({"job_id": "j1", "phase": "pulling"})
    with pytest.raises(ConflictError):
        await manager.retry_rollback()

    await store.write_journal(
        {
            "job_id": "j1",
            "phase": "renamed",
            "rollback_name": "rollback",
            "old_version": "0.2.0",
            "new_version": "0.3.0",
        }
    )
    docker = _RecoveryDocker({"rollback": {**_container(), "Id": "rollback-id"}})
    manager = _manager(tmp_path / "ok", docker)
    await manager.store.write_journal(
        {
            "job_id": "j1",
            "phase": "renamed",
            "rollback_name": "rollback",
            "old_version": "0.2.0",
            "new_version": "0.3.0",
        }
    )
    job = await manager.retry_rollback()
    assert job["state"] == "rolled_back"

    manager = _manager(tmp_path / "fail", _RecoveryDocker())
    await manager.store.write_journal(
        {"job_id": "j2", "phase": "renamed", "rollback_name": "missing"}
    )
    with pytest.raises(RecoveryError):
        await manager.retry_rollback()


# ══════════════════════════════════════════════════════════════════════
# updater/main (sidecar application)
# ══════════════════════════════════════════════════════════════════════


class _SidecarDocker:
    def __init__(self, *, ping_error=None, containers=None, image=None):
        self.ping_error = ping_error
        self.containers = containers or {}
        self.image = image or _image()
        self.closed = False

    async def ping(self):
        if self.ping_error:
            raise self.ping_error
        return True

    async def inspect_container(self, name):
        if name in self.containers:
            return self.containers[name]
        raise DockerError(404, "missing")

    async def inspect_image(self, _ref):
        return self.image

    async def close(self):
        self.closed = True


class _SidecarManager:
    def __init__(self, *, recover_error=None, sync_error=None, conflict=None):
        self.recover_error = recover_error
        self.sync_error = sync_error
        self.conflict = conflict

    async def recover(self):
        if self.recover_error:
            raise self.recover_error

    async def sync_current(self):
        if self.sync_error:
            raise self.sync_error

    async def snapshot(self):
        return {"current_version": "0.2.0", "job": None}

    async def install(self, version, latest):
        if self.conflict:
            raise self.conflict
        return {"id": "job-1", "version": version, "latest": latest}

    async def retry_rollback(self):
        if self.conflict:
            raise self.conflict
        return {"state": "rolled_back"}


@pytest.mark.asyncio
async def test_sidecar_lifespan_starts_recovers_and_closes(monkeypatch):
    docker = _SidecarDocker()
    manager = _SidecarManager()
    monkeypatch.setattr(updater_main, "DockerClient", lambda _path: docker)
    monkeypatch.setattr(updater_main, "StateStore", lambda _dir: object())
    monkeypatch.setattr(
        updater_main,
        "UpdateManager",
        lambda **_kwargs: manager,
    )

    async with updater_main.lifespan(updater_main.app):
        assert updater_main.docker is docker
        assert updater_main.manager is manager
    assert docker.closed is True

    # A failing recovery is logged but does not stop the sidecar.
    monkeypatch.setattr(
        updater_main,
        "UpdateManager",
        lambda **_kwargs: _SidecarManager(recover_error=RuntimeError("recover failed")),
    )
    async with updater_main.lifespan(updater_main.app):
        pass


@pytest.mark.asyncio
async def test_sidecar_health_and_target_errors(monkeypatch):
    monkeypatch.setattr(updater_main, "docker", None)
    with pytest.raises(HTTPException) as exc:
        await updater_main.health()
    assert exc.value.status_code == 503
    with pytest.raises(HTTPException):
        await updater_main._inspect_target()

    monkeypatch.setattr(
        updater_main, "docker", _SidecarDocker(ping_error=DockerError(500, "down"))
    )
    with pytest.raises(HTTPException) as exc:
        await updater_main.health()
    assert exc.value.status_code == 503

    monkeypatch.setattr(updater_main, "docker", _SidecarDocker())
    assert await updater_main.health() == {"status": "ok", "target": updater_main.TARGET_CONTAINER}

    monkeypatch.setattr(
        updater_main,
        "docker",
        _SidecarDocker(containers={"homst": _container()}, image=_image("0.2.0")),
    )
    info = await updater_main._inspect_target()
    assert info["name"] == "homst"
    assert info["version"] == "0.2.0"
    assert info["running"] is True

    class NotFound(_SidecarDocker):
        async def inspect_container(self, _name):
            raise DockerError(404, "missing")

    monkeypatch.setattr(updater_main, "docker", NotFound())
    with pytest.raises(HTTPException) as exc:
        await updater_main._inspect_target()
    assert exc.value.status_code == 404

    class Broken(_SidecarDocker):
        async def inspect_container(self, _name):
            raise DockerError(500, "daemon broke")

    monkeypatch.setattr(updater_main, "docker", Broken())
    with pytest.raises(HTTPException) as exc:
        await updater_main._inspect_target()
    assert exc.value.status_code == 500


def test_sidecar_target_info_defaults():
    info = updater_main._target_info({}, {})
    assert info == {
        "name": "",
        "container_id": None,
        "image": None,
        "image_id": None,
        "image_created": None,
        "labels": {},
        "version": None,
        "state": None,
        "running": False,
        "started_at": None,
    }


@pytest.mark.asyncio
async def test_sidecar_status_install_and_recovery_endpoints(monkeypatch):
    monkeypatch.setattr(updater_main, "manager", None)
    for call in (updater_main.status, updater_main.install, updater_main.retry_rollback):
        with pytest.raises(HTTPException) as exc:
            if call is updater_main.install:
                await call(updater_main.InstallBody(version="0.3.0"))
            else:
                await call()
        assert exc.value.status_code == 503

    manager = _SidecarManager(sync_error=RuntimeError("sync failed"))
    monkeypatch.setattr(updater_main, "manager", manager)
    assert (await updater_main.status())["current_version"] == "0.2.0"

    monkeypatch.setattr(
        updater_main, "manager", _SidecarManager(conflict=ConflictError("busy"))
    )
    with pytest.raises(HTTPException) as exc:
        await updater_main.install(updater_main.InstallBody(version="0.3.0"))
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as exc:
        await updater_main.retry_rollback()
    assert exc.value.status_code == 409

    monkeypatch.setattr(
        updater_main, "manager", _SidecarManager(conflict=RecoveryError("broken"))
    )
    with pytest.raises(HTTPException) as exc:
        await updater_main.retry_rollback()
    assert exc.value.status_code == 500

    monkeypatch.setattr(updater_main, "manager", _SidecarManager())
    installed = await updater_main.install(updater_main.InstallBody(version="0.3.0"))
    assert installed["version"] == "0.3.0"
    assert (await updater_main.retry_rollback())["state"] == "rolled_back"


@pytest.mark.asyncio
async def test_sidecar_target_route(monkeypatch):
    docker = _SidecarDocker(containers={"homst": _container()}, image=_image("0.2.0"))
    monkeypatch.setattr(updater_main, "docker", docker)
    assert (await updater_main.target())["version"] == "0.2.0"


# ══════════════════════════════════════════════════════════════════════
# updater/job: install paths and health polling
# ══════════════════════════════════════════════════════════════════════


class _RunDocker(_RecoveryDocker):
    def __init__(
        self,
        *,
        old_version="0.2.0",
        new_version="0.3.0",
        same_id=False,
        healthy=True,
        fail_tag=False,
        fail_remove=False,
        new_image_id=None,
        fail_start=False,
    ):
        container = _container(old_version)
        self.old_image = _image(old_version, "sha256:old")
        self.new_image = _image(
            new_version, new_image_id or ("sha256:old" if same_id else "sha256:new")
        )
        super().__init__({"homst": container})
        self.healthy = healthy
        self.fail_tag = fail_tag
        self.fail_remove = fail_remove
        self.fail_start = fail_start

    async def inspect_image(self, ref):
        if ref.startswith("ghcr.io/mrkprdo/homst:0.3.0") or ref == "sha256:new":
            return copy.deepcopy(self.new_image)
        if ref.startswith("ghcr.io/mrkprdo/homst:0."):
            # A rollback target that is not retained locally.
            raise DockerError(404, "missing")
        return copy.deepcopy(self.old_image)

    async def pull_image(self, _repo, _tag, on_progress=None):
        if on_progress:
            on_progress(50, 5, 10, "Halfway")
        self.calls.append(("pull", _repo, _tag))

    async def create_container(self, name, payload):
        self.containers[name] = {
            **_container(self.new_image["Config"]["Env"][0].split("=")[1]),
            "Id": "new-id",
            "Config": payload,
        }
        self.calls.append(("create", name))
        return {"Id": "new-id"}

    async def stop_container(self, container_id):
        for container in self.containers.values():
            if container["Id"] == container_id:
                container["State"] = {"Running": False, "Status": "exited"}
        self.calls.append(("stop", container_id))

    async def tag_image(self, ref, repo, tag):
        if self.fail_tag:
            raise DockerError(500, "tag failed")
        self.calls.append(("tag", ref, repo, tag))

    async def remove_container(self, container_id):
        if self.fail_remove:
            raise DockerError(500, "remove failed")
        self.calls.append(("remove", container_id))

    async def health_check(self, _container_id):
        return self.healthy


async def _run_install(tmp_path, docker, version="0.3.0", latest=True):
    manager = UpdateManager(
        docker=docker,
        store=StateStore(str(tmp_path)),
        target_name="homst",
        image_repo="ghcr.io/mrkprdo/homst",
        health_timeout=1,
    )
    await manager.install(version, latest=latest)
    await manager._task
    return manager


@pytest.mark.asyncio
async def test_inspect_optional_reraises_non_404():
    class Broken(_RecoveryDocker):
        async def inspect_container(self, _name):
            raise DockerError(500, "daemon")

    manager = UpdateManager(
        docker=Broken(), store=StateStore("unused"), target_name="homst",
        image_repo="x",
    )
    with pytest.raises(DockerError):
        await manager._inspect_optional("homst")


@pytest.mark.asyncio
async def test_install_success_tolerates_tag_and_remove_failures(tmp_path):
    docker = _RunDocker(fail_tag=True, fail_remove=True)
    manager = await _run_install(tmp_path, docker)
    state = await manager.snapshot()
    assert state["job"]["state"] == "success"
    assert state["current_version"] == "0.3.0"


@pytest.mark.asyncio
async def test_install_up_to_date_clears_matching_hold(tmp_path):
    docker = _RunDocker(same_id=True)
    store = StateStore(str(tmp_path))
    await store.update(held_version="0.3.0", held_reason="failed")
    manager = await _run_install(tmp_path, docker, version="0.3.0")
    state = await manager.snapshot()
    assert state["job"]["state"] == "up_to_date"
    assert state["held_version"] is None


@pytest.mark.asyncio
async def test_install_reports_a_version_mismatch_without_touching_the_container(tmp_path):
    docker = _RunDocker(new_version="9.9.9")
    manager = await _run_install(tmp_path, docker)
    state = await manager.snapshot()
    assert state["job"]["state"] == "failed"
    assert "expected 0.3.0" in state["job"]["error"]
    assert not any(call[0] == "stop" for call in docker.calls)


@pytest.mark.asyncio
async def test_install_rollback_keeps_newer_held_version_on_failure(tmp_path):
    docker = _RunDocker(healthy=False, fail_start=True)
    store = StateStore(str(tmp_path))
    await store.update(held_version="0.4.0", held_reason="older hold")
    manager = await _run_install(tmp_path, docker)
    state = await manager.snapshot()
    assert state["job"]["state"] == "failed"
    assert state["held_version"] == "0.4.0"

    invalid_path = tmp_path / "invalid"
    invalid_store = StateStore(str(invalid_path))
    await invalid_store.update(held_version="bad", held_reason="odd")
    docker = _RunDocker(healthy=False, fail_start=True)
    manager = await _run_install(invalid_path, docker)
    assert (await manager.snapshot())["job"]["state"] == "failed"


@pytest.mark.asyncio
async def test_install_failure_before_stop_keeps_the_running_version(tmp_path):
    class NoPull(_RunDocker):
        async def pull_image(self, *_args, **_kwargs):
            raise RuntimeError("registry offline")

    manager = await _run_install(tmp_path, NoPull())
    state = await manager.snapshot()
    assert state["job"]["state"] == "failed"
    assert "registry offline" in state["job"]["error"]


@pytest.mark.asyncio
async def test_install_older_version_uses_a_cached_image(tmp_path):
    docker = _RunDocker(old_version="0.4.0", new_version="0.3.0")

    async def inspect_cached(ref):
        if ref.startswith("ghcr.io/mrkprdo/homst:0.3.0"):
            return _image("0.3.0", "sha256:new")
        if ref.startswith("ghcr.io/mrkprdo/homst:0."):
            return _image("0.3.0", "sha256:new")
        return _image("0.4.0", "sha256:old")

    docker.inspect_image = inspect_cached
    manager = await _run_install(tmp_path, docker, version="0.3.0", latest=False)
    state = await manager.snapshot()
    assert state["job"]["state"] == "success"
    assert state["held_version"] == "0.4.0"


@pytest.mark.asyncio
async def test_install_older_version_ignores_a_missing_cached_image(tmp_path):
    docker = _RunDocker(old_version="0.4.0", new_version="0.3.0")

    calls = {"new": 0}

    async def inspect_missing_cache(ref):
        if ref.startswith("ghcr.io/mrkprdo/homst:0.3.0"):
            calls["new"] += 1
            if calls["new"] == 1:
                raise DockerError(404, "not retained")
            return _image("0.3.0", "sha256:new")
        return _image("0.4.0", "sha256:old")

    docker.inspect_image = inspect_missing_cache
    store = StateStore(str(tmp_path))
    await store.update(held_version="0.5.0", held_reason="newer hold")
    manager = await _run_install(tmp_path, docker, version="0.3.0", latest=False)
    state = await manager.snapshot()
    assert state["job"]["state"] == "success"
    assert state["held_version"] == "0.5.0"

    invalid_path = tmp_path / "invalid-hold"
    invalid_store = StateStore(str(invalid_path))
    await invalid_store.update(held_version="bad", held_reason="odd")
    calls["new"] = 0
    docker = _RunDocker(old_version="0.4.0", new_version="0.3.0")
    docker.inspect_image = inspect_missing_cache
    manager = await _run_install(invalid_path, docker, version="0.3.0", latest=False)
    assert (await manager.snapshot())["job"]["state"] == "success"


@pytest.mark.asyncio
async def test_install_success_clears_a_hold_for_the_same_version(tmp_path):
    docker = _RunDocker()
    store = StateStore(str(tmp_path))
    await store.update(held_version="0.3.0", held_reason="failed")
    manager = await _run_install(tmp_path, docker)
    state = await manager.snapshot()
    assert state["job"]["state"] == "success"
    assert state["held_version"] is None


@pytest.mark.asyncio
async def test_install_clears_an_older_or_invalid_hold_on_success(tmp_path):
    docker = _RunDocker()
    store = StateStore(str(tmp_path))
    await store.update(held_version="0.1.0", held_reason="old")
    manager = await _run_install(tmp_path, docker)
    assert (await manager.snapshot())["held_version"] is None

    store = StateStore(str(tmp_path / "invalid"))
    await store.update(held_version="bad", held_reason="odd")
    docker = _RunDocker()
    manager = await _run_install(tmp_path / "invalid", docker)
    assert (await manager.snapshot())["held_version"] == "bad"


@pytest.mark.asyncio
async def test_install_success_keeps_a_newer_held_version(tmp_path):
    docker = _RunDocker()
    store = StateStore(str(tmp_path))
    await store.update(held_version="0.9.0", held_reason="newer")
    manager = await _run_install(tmp_path, docker)
    assert (await manager.snapshot())["held_version"] == "0.9.0"


@pytest.mark.asyncio
async def test_wait_healthy_handles_errors_exits_and_timeouts(tmp_path, monkeypatch):
    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr("app.updater.job.asyncio.sleep", no_sleep)

    class Sequence(_RecoveryDocker):
        def __init__(self, states):
            super().__init__()
            self.states = list(states)

        async def inspect_container(self, _name):
            item = self.states.pop(0) if len(self.states) > 1 else self.states[0]
            if isinstance(item, Exception):
                raise item
            return item

        async def health_check(self, _name):
            return self.healthy

    manager = UpdateManager(
        docker=Sequence(
            [DockerError(500, "boom"), {"State": {"Running": False, "Status": "exited"}}]
        ),
        store=StateStore(str(tmp_path)),
        target_name="homst",
        image_repo="x",
    )
    assert await manager._wait_healthy("c1", timeout=1) is False

    manager.docker = Sequence([{"State": {"Running": True}}])
    manager.docker.healthy = False
    assert await manager._wait_healthy("c1", timeout=0.5) is False

    manager.docker = Sequence([{"State": {"Running": True}}])
    manager.docker.healthy = True
    assert await manager._wait_healthy("c1", timeout=0.5) is True
