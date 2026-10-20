"""FastAPI application for the optional updater sidecar.

Runs as a separate Compose profile so it can outlive the HOMST container
restart and is the only process with access to the Docker socket.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.updater.docker_api import DockerClient, DockerError
from app.updater.job import ConflictError, RecoveryError, UpdateManager, _image_version
from app.updater.state import StateStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [updater] %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("homst.updater")

DOCKER_SOCKET = os.environ.get("HOMST_DOCKER_SOCKET", "/var/run/docker.sock")
TARGET_CONTAINER = os.environ.get("HOMST_TARGET_CONTAINER", "homst")
IMAGE_REPO = os.environ.get("HOMST_IMAGE_REPO", "ghcr.io/mrkprdo/homst")
STATE_DIR = os.environ.get("HOMST_STATE_DIR", "/run/homst")
HEALTH_TIMEOUT = int(os.environ.get("HOMST_HEALTH_TIMEOUT", "180"))

docker: DockerClient | None = None
manager: UpdateManager | None = None


class InstallBody(BaseModel):
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    latest: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global docker, manager
    docker = DockerClient(DOCKER_SOCKET)
    store = StateStore(STATE_DIR)
    manager = UpdateManager(
        docker=docker,
        store=store,
        target_name=TARGET_CONTAINER,
        image_repo=IMAGE_REPO,
        health_timeout=HEALTH_TIMEOUT,
    )
    try:
        await manager.recover()
        await manager.sync_current()
    except Exception:
        logger.exception("Updater startup recovery failed")
    yield
    if docker:
        await docker.close()


app = FastAPI(title="HOMST Updater", version="1", lifespan=lifespan)


def _target_info(container: dict[str, Any], image: dict[str, Any]) -> dict[str, Any]:
    config = container.get("Config") or {}
    state = container.get("State") or {}
    return {
        "name": str(container.get("Name") or "").lstrip("/"),
        "container_id": container.get("Id"),
        "image": config.get("Image"),
        "image_id": container.get("Image"),
        "image_created": image.get("Created"),
        "labels": config.get("Labels") or {},
        "version": _image_version(image, container),
        "state": state.get("Status"),
        "running": bool(state.get("Running")),
        "started_at": state.get("StartedAt"),
    }


async def _inspect_target() -> dict[str, Any]:
    if docker is None:
        raise HTTPException(status_code=503, detail="Updater is still starting.")
    try:
        container = await docker.inspect_container(TARGET_CONTAINER)
        image = await docker.inspect_image(container["Image"])
    except DockerError as exc:
        if exc.status_code == 404:
            raise HTTPException(
                status_code=404, detail=f"Container '{TARGET_CONTAINER}' was not found."
            ) from exc
        raise HTTPException(status_code=500, detail=exc.message) from exc
    return _target_info(container, image)


@app.get("/health")
async def health():
    if docker is None:
        raise HTTPException(status_code=503, detail="Updater is starting.")
    try:
        await docker.ping()
    except DockerError as exc:
        raise HTTPException(status_code=503, detail=exc.message) from exc
    return {"status": "ok", "target": TARGET_CONTAINER}


@app.get("/target")
async def target():
    return await _inspect_target()


@app.get("/status")
async def status():
    if manager is None:
        raise HTTPException(status_code=503, detail="Updater is starting.")
    try:
        await manager.sync_current()
    except Exception:
        logger.exception("Could not refresh current version")
    return await manager.snapshot()


@app.post("/install", status_code=202)
async def install(body: InstallBody):
    if manager is None:
        raise HTTPException(status_code=503, detail="Updater is starting.")
    try:
        return await manager.install(body.version, latest=body.latest)
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/recovery/retry-rollback")
async def retry_rollback():
    if manager is None:
        raise HTTPException(status_code=503, detail="Updater is starting.")
    try:
        return await manager.retry_rollback()
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except RecoveryError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
