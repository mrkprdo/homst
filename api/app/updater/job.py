"""The updater job: pull, verify, recreate, health-check, roll back."""

from __future__ import annotations

import asyncio
import copy
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from packaging.version import InvalidVersion, Version

from app.updater.docker_api import DockerClient, DockerError
from app.updater.spec import merge_container_spec
from app.updater.state import StateStore

logger = logging.getLogger("homst.updater.job")

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
ACTIVE_STATES = {"queued", "pulling", "restarting", "verifying", "rolling_back"}


class ConflictError(Exception):
    pass


class RecoveryError(Exception):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_older(candidate: str | None, current: str | None) -> bool:
    try:
        return bool(candidate and current and Version(candidate) < Version(current))
    except InvalidVersion:
        return False


def _image_version(image: dict[str, Any], container: dict[str, Any] | None = None) -> str | None:
    # The image's own HOMST_VERSION env is baked from the Docker build arg and
    # is not affected by registry/metadata labelling. Prefer it; fall back to
    # the OCI label and finally a container-level override.
    env = (image.get("Config") or {}).get("Env") or []
    for item in env:
        key, _, value = item.partition("=")
        if key == "HOMST_VERSION" and value:
            return value
    labels = (image.get("Config") or {}).get("Labels") or {}
    version = labels.get("org.opencontainers.image.version")
    if version:
        return str(version)
    if container:
        for item in (container.get("Config") or {}).get("Env") or []:
            key, _, value = item.partition("=")
            if key == "HOMST_VERSION" and value:
                return value
    return None


class UpdateManager:
    def __init__(
        self,
        docker: DockerClient,
        store: StateStore,
        target_name: str,
        image_repo: str,
        health_timeout: int = 180,
    ):
        self.docker = docker
        self.store = store
        self.target_name = target_name
        self.image_repo = image_repo
        self.health_timeout = health_timeout
        self._busy = False
        self._job: dict[str, Any] | None = None
        self._task: asyncio.Task | None = None

    async def snapshot(self) -> dict[str, Any]:
        state = await self.store.snapshot()
        if self._job is not None:
            state["job"] = copy.deepcopy(self._job)
        return state

    async def _inspect_optional(self, name: str) -> dict[str, Any] | None:
        try:
            return await self.docker.inspect_container(name)
        except DockerError as exc:
            if exc.status_code == 404:
                return None
            raise

    async def sync_current(self) -> None:
        target = await self._inspect_optional(self.target_name)
        if not target:
            return
        try:
            image = await self.docker.inspect_image(target["Image"])
        except DockerError:
            image = {}
        version = _image_version(image, target)
        state = await self.store.snapshot()
        changes: dict[str, Any] = {"updated_at": _now()}
        if version and version != state.get("current_version"):
            changes["current_version"] = version

        # A hold is only meaningful while the held version is newer than what
        # is actually running. Clear it after a manual install of that version
        # (or anything newer).
        held = state.get("held_version")
        if held and version:
            try:
                if Version(held) <= Version(version):
                    changes["held_version"] = None
                    changes["held_reason"] = None
            except InvalidVersion:
                pass

        if len(changes) > 1:
            await self.store.update(**changes)

    async def recover(self) -> None:
        state = await self.store.snapshot()
        job = state.get("last_job")
        journal = await self.store.journal()
        self._job = job

        if not journal:
            if job and job.get("state") in ACTIVE_STATES:
                job = {
                    **job,
                    "state": "failed",
                    "message": "Updater restarted before the update completed.",
                    "error": "Updater restarted before the update completed.",
                    "finished_at": _now(),
                }
                self._job = job
                await self.store.update(last_job=job, updated_at=_now())
            return

        logger.warning("Recovering interrupted update %s", journal.get("job_id"))
        phase = journal.get("phase")
        target = await self._inspect_optional(self.target_name)
        rollback = await self._inspect_optional(journal.get("rollback_name") or "")

        if phase in ("pulling", "prepared"):
            # The old container was never stopped.
            job = {
                **(job or {}),
                "state": "failed",
                "message": (
                    "Updater restarted during the download. "
                    "The running version was not changed."
                ),
                "error": "Updater restarted during the download.",
                "finished_at": _now(),
            }
            self._job = job
            await self.store.update(last_job=job, updated_at=_now())
            await self.store.clear_journal()
            return

        # The updater died around the stop/rename step. The container may be
        # the old one under its original name, possibly stopped. Restore it.
        new_container_id = journal.get("new_container_id")
        old_is_target = bool(target) and (
            not new_container_id or target.get("Id") != new_container_id
        )
        if (
            phase in ("stopping", "stopped", "renaming", "rolling_back")
            and target
            and old_is_target
        ):
            running = bool(target.get("State", {}).get("Running"))
            if not running:
                try:
                    await self.docker.start_container(target["Id"])
                    running = await self._wait_healthy(target["Id"], timeout=60)
                except DockerError:
                    running = False
            if running:
                job = {
                    **(job or {}),
                    "state": "rolled_back",
                    "message": (
                        "The update was interrupted and the previous version "
                        "was restored."
                    ),
                    "error": "Updater restarted during the update.",
                    "finished_at": _now(),
                }
                self._job = job
                await self.store.update(
                    current_version=journal.get("old_version"),
                    held_version=journal.get("new_version"),
                    held_reason="Updater restarted during the update.",
                    last_job=job,
                    updated_at=_now(),
                )
                await self.store.clear_journal()
                return

        if target and target.get("State", {}).get("Running"):
            target_is_new = bool(new_container_id) and (
                target.get("Id") == new_container_id
            )
            healthy = target_is_new and await self._wait_healthy(
                target["Id"], timeout=45
            )
            if healthy:
                if rollback:
                    await self.docker.remove_container(rollback["Id"])
                version = journal.get("new_version")
                if job and job.get("latest"):
                    try:
                        await self.docker.tag_image(
                            journal.get("new_image_ref") or f"{self.image_repo}:{version}",
                            self.image_repo,
                            "latest",
                        )
                    except DockerError as exc:
                        logger.warning("Could not retag latest during recovery: %s", exc)
                job = {
                    **(job or {}),
                    "state": "success",
                    "message": f"Update to {version} completed.",
                    "error": None,
                    "finished_at": _now(),
                }
                self._job = job
                await self.store.update(
                    current_version=version,
                    previous_version=journal.get("old_version"),
                    previous_image=journal.get("old_image"),
                    held_version=None,
                    held_reason=None,
                    last_job=job,
                    updated_at=_now(),
                )
                await self.store.clear_journal()
                return

        if rollback:
            if target:
                await self.docker.remove_container(target["Id"])
            await self.docker.rename_container(rollback["Id"], self.target_name)
            await self.docker.start_container(rollback["Id"])
            await self._wait_healthy(rollback["Id"], timeout=60)
            job = {
                **(job or {}),
                "state": "rolled_back",
                "message": "The update was interrupted and the previous version was restored.",
                "error": "Updater restarted during the update.",
                "finished_at": _now(),
            }
            self._job = job
            await self.store.update(
                current_version=journal.get("old_version"),
                held_version=journal.get("new_version"),
                held_reason="Updater restarted during the update.",
                last_job=job,
                updated_at=_now(),
            )
            await self.store.clear_journal()
            return

        job = {
            **(job or {}),
            "state": "failed",
            "message": "The update was interrupted and could not be recovered automatically.",
            "error": "No running container and no rollback container were found.",
            "finished_at": _now(),
        }
        self._job = job
        await self.store.update(last_job=job, updated_at=_now())
        await self.store.clear_journal()

    async def install(self, version: str, latest: bool) -> dict[str, Any]:
        if not VERSION_RE.match(version):
            raise ConflictError("Only stable x.y.z versions can be installed.")
        if self._busy:
            raise ConflictError("An update is already in progress.")
        state = await self.store.snapshot()
        current_job = self._job or state.get("last_job") or {}
        if current_job.get("state") in ACTIVE_STATES:
            raise ConflictError("An update is already in progress.")

        self._busy = True
        job_id = uuid.uuid4().hex
        job = {
            "id": job_id,
            "state": "queued",
            "version": version,
            "latest": latest,
            "message": "Queued",
            "progress": {"percent": 0, "bytes": 0, "total": 0},
            "error": None,
            "from_version": None,
            "to_version": version,
            "started_at": _now(),
            "finished_at": None,
            "updated_at": _now(),
        }
        self._job = job
        await self.store.update(last_job=job, updated_at=_now())
        self._task = asyncio.create_task(self._run(job_id, version, latest))
        return copy.deepcopy(job)

    def _set_job(self, **changes: Any) -> None:
        if self._job is None:
            return
        self._job.update(changes)
        self._job["updated_at"] = _now()

    async def _persist_job(self) -> None:
        if self._job is not None:
            await self.store.update(last_job=copy.deepcopy(self._job), updated_at=_now())

    async def _run(self, job_id: str, version: str, latest: bool) -> None:
        old_container: dict[str, Any] | None = None
        old_image: dict[str, Any] | None = None
        old_version: str | None = None
        old_image_ref: str | None = None
        before_state: dict[str, Any] = {}
        journal: dict[str, Any] | None = None
        new_container_id: str | None = None
        rollback_name = f"homst__previous_{job_id[:12]}"
        new_ref = f"{self.image_repo}:{version}"

        try:
            before_state = await self.store.snapshot()
            old_container = await self.docker.inspect_container(self.target_name)
            old_version = _image_version(
                await self.docker.inspect_image(old_container["Image"]), old_container
            )
            old_image_ref = (old_container.get("Config") or {}).get("Image")
            old_image = await self.docker.inspect_image(old_container["Image"])

            # Rollbacks prefer the retained local image: they should work even
            # if the registry is offline, and the previous build is exactly what
            # we want. Updates always pull the exact stable tag.
            cached_image: dict[str, Any] | None = None
            if old_version and _is_older(version, old_version):
                try:
                    candidate = await self.docker.inspect_image(new_ref)
                    candidate_version = _image_version(candidate)
                    if not candidate_version or candidate_version == version:
                        cached_image = candidate
                except DockerError:
                    cached_image = None

            if cached_image:
                self._set_job(
                    state="restarting",
                    message=f"Using retained HOMST {version}…",
                    progress={"percent": 100, "bytes": 0, "total": 0},
                    from_version=old_version,
                )
            else:
                self._set_job(
                    state="pulling",
                    message=f"Pulling HOMST {version}…",
                    from_version=old_version,
                )
            await self._persist_job()

            journal = {
                "job_id": job_id,
                "phase": "prepared" if cached_image else "pulling",
                "target_name": self.target_name,
                "rollback_name": rollback_name,
                "old_container_id": old_container["Id"],
                "old_image_id": old_container["Image"],
                "old_image": old_image_ref,
                "old_version": old_version,
                "new_version": version,
                "new_image_ref": new_ref,
                "new_container_id": None,
                "started_at": _now(),
            }
            await self.store.write_journal(journal)

            if cached_image:
                new_image = cached_image
            else:
                def on_progress(
                    percent: float, downloaded: int, total: int, message: str
                ) -> None:
                    self._set_job(
                        progress={
                            "percent": round(percent, 1),
                            "bytes": downloaded,
                            "total": total,
                        },
                        message=f"Pulling HOMST {version}… {percent:.0f}%",
                    )

                await self.docker.pull_image(self.image_repo, version, on_progress)
                new_image = await self.docker.inspect_image(new_ref)

            image_version = _image_version(new_image)
            if image_version and image_version != version:
                raise RuntimeError(
                    f"Image reports version {image_version}, expected {version}. "
                    "The running version was not changed."
                )

            journal["phase"] = "prepared"
            await self.store.write_journal(journal)

            if new_image["Id"] == old_container["Image"]:
                held_version = before_state.get("held_version")
                held_reason = before_state.get("held_reason")
                if held_version == version:
                    held_version = None
                    held_reason = None
                self._set_job(
                    state="up_to_date",
                    message=f"HOMST {version} is already the running image. Nothing restarted.",
                    progress={"percent": 100, "bytes": 0, "total": 0},
                    finished_at=_now(),
                )
                await self._persist_job()
                await self.store.update(
                    held_version=held_version,
                    held_reason=held_reason,
                    last_job=copy.deepcopy(self._job),
                    updated_at=_now(),
                )
                await self.store.clear_journal()
                return

            payload = merge_container_spec(
                old_container,
                old_image,
                new_image,
                new_ref,
                version,
            )

            self._set_job(
                state="restarting",
                message="Stopping the current container…",
                progress={"percent": 100, "bytes": 0, "total": 0},
            )
            await self._persist_job()

            journal["phase"] = "stopping"
            await self.store.write_journal(journal)
            await self.docker.stop_container(old_container["Id"])
            journal["phase"] = "stopped"
            await self.store.write_journal(journal)
            journal["phase"] = "renaming"
            await self.store.write_journal(journal)
            await self.docker.rename_container(old_container["Id"], rollback_name)
            journal["phase"] = "renamed"
            await self.store.write_journal(journal)

            journal["phase"] = "creating"
            await self.store.write_journal(journal)
            created = await self.docker.create_container(self.target_name, payload)
            new_container_id = created["Id"]
            journal["new_container_id"] = new_container_id
            journal["phase"] = "created"
            await self.store.write_journal(journal)

            self._set_job(state="verifying", message="Starting the new version…")
            await self._persist_job()
            journal["phase"] = "starting"
            await self.store.write_journal(journal)
            await self.docker.start_container(new_container_id)
            journal["phase"] = "verifying"
            await self.store.write_journal(journal)

            healthy = await self._wait_healthy(new_container_id, timeout=self.health_timeout)
            if not healthy:
                raise RuntimeError(
                    "The new container did not pass its health check in time."
                )

            # Success: keep the old image. Only now move the local latest tag.
            if latest:
                try:
                    await self.docker.tag_image(new_ref, self.image_repo, "latest")
                except DockerError as exc:
                    logger.warning("Could not retag latest: %s", exc)

            try:
                await self.docker.remove_container(old_container["Id"])
            except DockerError as exc:
                logger.warning("Could not remove previous container: %s", exc)

            self._set_job(
                state="success",
                message=f"Updated to HOMST {version}.",
                progress={"percent": 100, "bytes": 0, "total": 0},
                finished_at=_now(),
                error=None,
            )
            history = list(before_state.get("history") or [])
            history.insert(
                0,
                {
                    "version": version,
                    "previous_version": old_version,
                    "state": "success",
                    "at": _now(),
                },
            )
            held_version = before_state.get("held_version")
            held_reason = before_state.get("held_reason")
            if old_version and _is_older(version, old_version):
                held_version = old_version
                held_reason = (
                    "Update prompts are paused for the version you rolled back from."
                )
                previous_held = before_state.get("held_version")
                if previous_held:
                    try:
                        if Version(previous_held) > Version(held_version):
                            held_version = previous_held
                            held_reason = before_state.get("held_reason")
                    except InvalidVersion:
                        pass
            elif held_version == version:
                held_version = None
                held_reason = None
            elif held_version:
                try:
                    if Version(held_version) < Version(version):
                        held_version = None
                        held_reason = None
                except InvalidVersion:
                    pass

            await self.store.update(
                current_version=version,
                previous_version=old_version,
                previous_image=old_image_ref,
                held_version=held_version,
                held_reason=held_reason,
                history=history[:20],
                last_job=copy.deepcopy(self._job),
                updated_at=_now(),
            )
            await self.store.clear_journal()
            logger.info("Updated HOMST %s -> %s", old_version, version)
        except Exception as exc:
            logger.exception("Update to %s failed", version)
            error = str(exc)
            # If the old container was not stopped yet, the running build is intact.
            old_stopped = bool(
                journal
                and journal.get("phase")
                in (
                    "stopping",
                    "stopped",
                    "renaming",
                    "renamed",
                    "creating",
                    "created",
                    "starting",
                    "verifying",
                )
            )
            if old_stopped:
                self._set_job(
                    state="rolling_back",
                    message="Update failed. Restoring the previous version…",
                    error=error,
                )
                await self._persist_job()
                if journal:
                    journal["phase"] = "rolling_back"
                    await self.store.write_journal(journal)
                rolled_back = await self._rollback(old_container, rollback_name)
                if rolled_back:
                    self._set_job(
                        state="rolled_back",
                        message=(
                            f"Update to {version} failed. HOMST is still running "
                            f"{old_version or 'the previous version'}."
                        ),
                        error=error,
                        finished_at=_now(),
                        progress={"percent": 0, "bytes": 0, "total": 0},
                    )
                else:
                    self._set_job(
                        state="failed",
                        message=(
                            "Update failed and the previous version could not be "
                            "restored automatically."
                        ),
                        error=error,
                        finished_at=_now(),
                    )
                history = list(before_state.get("history") or [])
                history.insert(
                    0,
                    {
                        "version": version,
                        "previous_version": old_version,
                        "state": "rolled_back" if rolled_back else "failed",
                        "at": _now(),
                        "error": error,
                    },
                )
                held_version = version
                held_reason = error
                previous_held = before_state.get("held_version")
                if previous_held:
                    try:
                        if Version(previous_held) > Version(version):
                            held_version = previous_held
                            held_reason = before_state.get("held_reason")
                    except InvalidVersion:
                        pass
                await self.store.update(
                    current_version=old_version,
                    previous_version=before_state.get("previous_version"),
                    previous_image=before_state.get("previous_image"),
                    held_version=held_version,
                    held_reason=held_reason,
                    history=history[:20],
                    last_job=copy.deepcopy(self._job),
                    updated_at=_now(),
                )
                if rolled_back:
                    await self.store.clear_journal()
            else:
                self._set_job(
                    state="failed",
                    message=(
                        f"Could not install HOMST {version}. The running version was not changed."
                    ),
                    error=error,
                    finished_at=_now(),
                    progress={"percent": 0, "bytes": 0, "total": 0},
                )
                history = list(before_state.get("history") or [])
                history.insert(
                    0,
                    {
                        "version": version,
                        "previous_version": old_version,
                        "state": "failed",
                        "at": _now(),
                        "error": error,
                    },
                )
                await self.store.update(
                    history=history[:20],
                    last_job=copy.deepcopy(self._job),
                    updated_at=_now(),
                )
                await self.store.clear_journal()
        finally:
            self._busy = False
            self._task = None
            if self._job is not None:
                await self._persist_job()

    async def _wait_healthy(self, container_id: str, timeout: int) -> bool:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            try:
                info = await self.docker.inspect_container(container_id)
            except DockerError:
                info = {}
            if not info.get("State", {}).get("Running"):
                if info.get("State", {}).get("Status") in ("exited", "dead"):
                    return False
            elif await self.docker.health_check(container_id):
                return True
            await asyncio.sleep(2)
        return False

    async def _rollback(
        self,
        old_container: dict[str, Any] | None,
        rollback_name: str,
    ) -> bool:
        try:
            previous = await self._inspect_optional(rollback_name)
            if not previous:
                # If the old container never got renamed, it is still running
                # under its original ID; leave it alone.
                if old_container:
                    try:
                        current_old = await self.docker.inspect_container(
                            old_container["Id"]
                        )
                    except DockerError:
                        current_old = None
                    if current_old and current_old.get("State", {}).get("Running"):
                        return True
                    if current_old:
                        await self.docker.start_container(current_old["Id"])
                        return await self._wait_healthy(current_old["Id"], timeout=60)
                return False
            current = await self._inspect_optional(self.target_name)
            if current:
                await self.docker.remove_container(current["Id"])
            await self.docker.rename_container(previous["Id"], self.target_name)
            await self.docker.start_container(previous["Id"])
            return await self._wait_healthy(previous["Id"], timeout=60)
        except Exception as exc:
            logger.exception("Rollback failed: %s", exc)
            return False

    async def retry_rollback(self) -> dict[str, Any]:
        if self._busy:
            raise ConflictError("An update is currently in progress.")
        journal = await self.store.journal()
        if not journal:
            raise ConflictError("There is no interrupted update to recover.")
        if journal.get("phase") in ("pulling", "prepared"):
            raise ConflictError("The running container was not changed by that update.")

        self._busy = True
        try:
            rolled_back = await self._rollback(None, journal.get("rollback_name"))
            if not rolled_back:
                raise RecoveryError(
                    "Could not restore the previous container. Check the updater logs."
                )
            job = {
                "id": journal.get("job_id"),
                "state": "rolled_back",
                "version": journal.get("new_version"),
                "latest": False,
                "message": "Previous version restored.",
                "progress": {"percent": 0, "bytes": 0, "total": 0},
                "error": None,
                "from_version": journal.get("old_version"),
                "to_version": journal.get("old_version"),
                "started_at": journal.get("started_at"),
                "finished_at": _now(),
                "updated_at": _now(),
            }
            self._job = job
            await self.store.update(
                current_version=journal.get("old_version"),
                held_version=journal.get("new_version"),
                held_reason="Manual recovery after a failed update.",
                last_job=job,
                updated_at=_now(),
            )
            await self.store.clear_journal()
            return job
        finally:
            self._busy = False
