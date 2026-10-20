import copy

import pytest

from app.updater.docker_api import DockerError
from app.updater.job import UpdateManager
from app.updater.state import StateStore


def _image(version: str, image_id: str) -> dict:
    return {
        "Id": image_id,
        "Config": {
            "Env": [f"HOMST_VERSION={version}"],
            "Cmd": ["supervisord"],
            "Entrypoint": ["entrypoint"],
            "Labels": {"org.opencontainers.image.version": version},
            "ExposedPorts": {"8443/tcp": {}},
        },
    }


def _container(version: str, image_id: str, image_ref: str) -> dict:
    return {
        "Id": "old-container-id",
        "Name": "/homst",
        "Image": image_id,
        "Config": {
            "Image": image_ref,
            "Env": [f"HOMST_VERSION={version}"],
            "Cmd": ["supervisord"],
            "Entrypoint": ["entrypoint"],
            "Labels": {"com.docker.compose.project": "homst-prod"},
            "ExposedPorts": {"8443/tcp": {}},
        },
        "HostConfig": {
            "Binds": ["homst-prod_photo_uploads:/app/uploads"],
            "PortBindings": {"8443/tcp": [{"HostPort": "8443"}]},
            "RestartPolicy": {"Name": "unless-stopped"},
            "NetworkMode": "homst-prod_default",
        },
        "NetworkSettings": {"Networks": {"homst-prod_default": {"Aliases": ["homst"]}}},
        "Mounts": [],
        "State": {"Running": True, "Status": "running"},
    }


class FakeDocker:
    def __init__(self, new_version="0.3.0", new_image_id="sha256:new", old_version="0.2.0"):
        self.old_image_id = "sha256:old"
        self.new_image_id = new_image_id
        self.old_version = old_version
        self.new_version = new_version
        self.old_ref = "ghcr.io/mrkprdo/homst:latest"
        self.new_ref = f"ghcr.io/mrkprdo/homst:{new_version}"
        self.images = {
            self.old_image_id: _image(old_version, self.old_image_id),
            self.new_ref: _image(new_version, self.new_image_id),
        }
        self.containers = {
            "homst": _container(old_version, self.old_image_id, self.old_ref)
        }
        self.calls = []
        self.healthy = True
        self._next_id = "new-container-id"

    def _by_id(self, container_id):
        for name, container in list(self.containers.items()):
            if container["Id"] == container_id:
                return name, container
        raise DockerError(404, "not found")

    async def inspect_container(self, name):
        if name in self.containers:
            return copy.deepcopy(self.containers[name])
        for container in self.containers.values():
            if container["Id"] == name:
                return copy.deepcopy(container)
        raise DockerError(404, "not found")

    async def inspect_image(self, ref):
        if ref in self.images:
            return copy.deepcopy(self.images[ref])
        for container in self.containers.values():
            if container["Config"]["Image"] == ref:
                return copy.deepcopy(self.images[container["Image"]])
        raise DockerError(404, "image not found")

    async def pull_image(self, repo, tag, on_progress=None):
        self.calls.append(("pull", repo, tag))
        if on_progress:
            on_progress(100, 10, 10, "Pull complete")

    async def tag_image(self, ref, repo, tag):
        self.calls.append(("tag", ref, tag))

    async def stop_container(self, container_id, timeout=30):
        _, container = self._by_id(container_id)
        container["State"] = {"Running": False, "Status": "exited"}
        self.calls.append(("stop", container_id))

    async def rename_container(self, container_id, name):
        old_name, container = self._by_id(container_id)
        del self.containers[old_name]
        container["Name"] = f"/{name}"
        self.containers[name] = container
        self.calls.append(("rename", name))

    async def create_container(self, name, payload):
        container = _container(self.new_version, self.new_image_id, payload["Image"])
        container["Id"] = self._next_id
        container["Config"] = payload
        container["HostConfig"] = payload["HostConfig"]
        container["State"] = {"Running": False, "Status": "created"}
        self.containers[name] = container
        self.calls.append(("create", name))
        return {"Id": self._next_id}

    async def start_container(self, container_id):
        _, container = self._by_id(container_id)
        container["State"] = {"Running": True, "Status": "running"}
        self.calls.append(("start", container_id))

    async def remove_container(self, container_id, force=True):
        try:
            name, _ = self._by_id(container_id)
        except DockerError:
            return
        del self.containers[name]
        self.calls.append(("remove", container_id))

    async def health_check(self, container_id):
        # The previous version is always healthy in this fake; only the new
        # container's health is controlled by the test.
        return self.healthy or container_id == "old-container-id"


async def _manager(tmp_path, docker, health_timeout=0):
    return UpdateManager(
        docker=docker,
        store=StateStore(str(tmp_path)),
        target_name="homst",
        image_repo="ghcr.io/mrkprdo/homst",
        health_timeout=health_timeout,
    )


@pytest.mark.asyncio
async def test_update_success_keeps_previous_image_and_retags_latest(tmp_path):
    docker = FakeDocker()
    manager = await _manager(tmp_path, docker, health_timeout=5)

    job = await manager.install("0.3.0", latest=True)
    assert job["state"] == "queued"
    await manager._task

    state = await manager.snapshot()
    assert state["current_version"] == "0.3.0"
    assert state["previous_version"] == "0.2.0"
    assert state["held_version"] is None
    assert state["job"]["state"] == "success"
    assert ("tag", "ghcr.io/mrkprdo/homst:0.3.0", "latest") in docker.calls
    # The old image remains available for rollback.
    assert docker.old_image_id in docker.images


@pytest.mark.asyncio
async def test_update_failure_restores_previous_version_and_holds_new_one(tmp_path):
    docker = FakeDocker()
    docker.healthy = False
    manager = await _manager(tmp_path, docker, health_timeout=0)

    await manager.install("0.3.0", latest=True)
    await manager._task

    state = await manager.snapshot()
    assert state["current_version"] == "0.2.0"
    assert state["held_version"] == "0.3.0"
    assert state["job"]["state"] == "rolled_back"
    assert docker.containers["homst"]["Config"]["Env"][0] == "HOMST_VERSION=0.2.0"
    assert ("rename", "homst") in docker.calls


@pytest.mark.asyncio
async def test_same_image_id_is_a_no_op(tmp_path):
    docker = FakeDocker(new_image_id="sha256:old")
    manager = await _manager(tmp_path, docker, health_timeout=5)

    await manager.install("0.3.0", latest=True)
    await manager._task

    state = await manager.snapshot()
    assert state["job"]["state"] == "up_to_date"
    assert not any(call[0] == "stop" for call in docker.calls)


@pytest.mark.asyncio
async def test_manual_rollback_holds_the_newer_version(tmp_path):
    docker = FakeDocker(old_version="0.4.0")
    manager = await _manager(tmp_path, docker, health_timeout=5)

    await manager.install("0.3.0", latest=False)
    await manager._task

    state = await manager.snapshot()
    assert state["current_version"] == "0.3.0"
    assert state["held_version"] == "0.4.0"
    assert state["job"]["state"] == "success"
    # The retained image is used instead of contacting the registry.
    assert not any(call[0] == "pull" for call in docker.calls)


@pytest.mark.asyncio
async def test_recovery_starts_a_stopped_previous_container(tmp_path):
    docker = FakeDocker()
    docker.containers["homst"]["State"] = {"Running": False, "Status": "exited"}
    store = StateStore(str(tmp_path))
    await store.update(
        current_version="0.2.0",
        last_job={
            "id": "job-1",
            "state": "restarting",
            "version": "0.3.0",
            "latest": True,
        },
    )
    await store.write_journal(
        {
            "job_id": "job-1",
            "phase": "stopped",
            "target_name": "homst",
            "rollback_name": "homst__previous_job1",
            "old_container_id": "old-container-id",
            "old_image_id": "sha256:old",
            "old_image": docker.old_ref,
            "old_version": "0.2.0",
            "new_version": "0.3.0",
            "new_image_ref": docker.new_ref,
            "new_container_id": None,
            "started_at": "2026-01-01T00:00:00Z",
        }
    )
    manager = UpdateManager(
        docker=docker,
        store=store,
        target_name="homst",
        image_repo="ghcr.io/mrkprdo/homst",
        health_timeout=5,
    )

    await manager.recover()

    state = await manager.snapshot()
    assert docker.containers["homst"]["State"]["Running"] is True
    assert state["current_version"] == "0.2.0"
    assert state["held_version"] == "0.3.0"
    assert state["job"]["state"] == "rolled_back"


@pytest.mark.asyncio
async def test_recovery_completes_a_restored_but_stopped_previous_container(tmp_path):
    docker = FakeDocker()
    docker.containers["homst"]["State"] = {"Running": False, "Status": "exited"}
    store = StateStore(str(tmp_path))
    await store.update(
        current_version="0.2.0",
        last_job={"id": "job-1", "state": "rolling_back", "version": "0.3.0"},
    )
    await store.write_journal(
        {
            "job_id": "job-1",
            "phase": "rolling_back",
            "target_name": "homst",
            "rollback_name": "homst__previous_job1",
            "old_container_id": "old-container-id",
            "old_image_id": "sha256:old",
            "old_image": docker.old_ref,
            "old_version": "0.2.0",
            "new_version": "0.3.0",
            "new_image_ref": docker.new_ref,
            "new_container_id": "new-container-id",
            "started_at": "2026-01-01T00:00:00Z",
        }
    )
    manager = UpdateManager(
        docker=docker,
        store=store,
        target_name="homst",
        image_repo="ghcr.io/mrkprdo/homst",
        health_timeout=5,
    )

    await manager.recover()

    state = await manager.snapshot()
    assert docker.containers["homst"]["State"]["Running"] is True
    assert state["current_version"] == "0.2.0"
    assert state["held_version"] == "0.3.0"
    assert state["job"]["state"] == "rolled_back"
