"""Build a new container spec from the old container + old/new images.

The goal is to let Docker/Compose-managed settings survive, while taking
image-defined defaults (env, command, entrypoint, healthcheck, labels) from
the *new* image.  This avoids the classic self-update bug where the new
container still runs the old image's entrypoint or reports an old version.
"""

from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from typing import Any

CONFIG_KEYS = (
    "Hostname",
    "Domainname",
    "User",
    "AttachStdin",
    "AttachStdout",
    "AttachStderr",
    "Tty",
    "OpenStdin",
    "StdinOnce",
    "Env",
    "Cmd",
    "Image",
    "Volumes",
    "WorkingDir",
    "Entrypoint",
    "OnBuild",
    "Labels",
    "StopSignal",
    "StopTimeout",
    "Shell",
    "Healthcheck",
    "ExposedPorts",
)

OVERRIDE_KEYS = (
    "User",
    "Cmd",
    "WorkingDir",
    "Entrypoint",
    "StopSignal",
    "StopTimeout",
    "Shell",
    "Healthcheck",
)


def _normalized(value: Any) -> Any:
    if isinstance(value, list):
        return tuple(value)
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True)
    return value


def _override(old_config: dict, old_image_config: dict, key: str) -> Any:
    if key not in old_config:
        return None
    if _normalized(old_config.get(key)) == _normalized(old_image_config.get(key)):
        return None
    return copy.deepcopy(old_config.get(key))


def merge_env(
    old_env: list[str] | None,
    old_image_env: list[str] | None,
    new_image_env: list[str] | None,
) -> list[str]:
    def as_map(items: list[str] | None) -> dict[str, str | None]:
        result: dict[str, str | None] = {}
        for item in items or []:
            key, sep, value = item.partition("=")
            result[key] = value if sep else None
        return result

    old_image = as_map(old_image_env)
    overrides: dict[str, str | None] = {}
    for item in old_env or []:
        key, sep, value = item.partition("=")
        value = value if sep else None
        if key not in old_image or old_image[key] != value:
            overrides[key] = value

    result = [
        item
        for item in (new_image_env or [])
        if item.partition("=")[0] not in overrides
    ]
    for key, value in overrides.items():
        result.append(f"{key}={value}" if value is not None else key)
    return result


def _binds_from_mounts(mounts: list[dict] | None) -> list[str]:
    binds: list[str] = []
    for mount in mounts or []:
        source = mount.get("Name") if mount.get("Type") == "volume" else mount.get("Source")
        destination = mount.get("Destination")
        if not source or not destination:
            continue
        spec = f"{source}:{destination}"
        if mount.get("RW") is False:
            spec += ":ro"
        binds.append(spec)
    return binds


def merge_container_spec(
    old_container: dict[str, Any],
    old_image: dict[str, Any],
    new_image: dict[str, Any],
    new_image_ref: str,
    version: str,
) -> dict[str, Any]:
    old_config = old_container.get("Config") or {}
    old_image_config = old_image.get("Config") or {}
    new_image_config = new_image.get("Config") or {}

    config: dict[str, Any] = {}
    for key in CONFIG_KEYS:
        if key in new_image_config:
            config[key] = copy.deepcopy(new_image_config[key])

    config["Image"] = new_image_ref
    config["Env"] = merge_env(
        old_config.get("Env"),
        old_image_config.get("Env"),
        new_image_config.get("Env"),
    )
    config["AttachStdout"] = False
    config["AttachStderr"] = False
    config["AttachStdin"] = False
    config["OpenStdin"] = False
    config["StdinOnce"] = False
    config["Tty"] = bool(old_config.get("Tty", False))

    for key in OVERRIDE_KEYS:
        value = _override(old_config, old_image_config, key)
        if value is not None:
            config[key] = value
        elif key not in new_image_config:
            config.pop(key, None)

    # Preserve user/Compose labels, but refresh image labels (notably the
    # version label) from the new image.
    labels = dict(old_config.get("Labels") or {})
    labels.update(new_image_config.get("Labels") or {})
    if new_image.get("Id") and "com.docker.compose.image" in labels:
        labels["com.docker.compose.image"] = new_image["Id"]
    labels.update(
        {
            "homst.managed": "true",
            "homst.version": version,
            "homst.updated_at": datetime.now(timezone.utc).isoformat(),
            "org.opencontainers.image.version": version,
        }
    )
    config["Labels"] = labels

    old_hostname = old_config.get("Hostname")
    old_id = str(old_container.get("Id") or "")
    if old_hostname and old_hostname not in (old_id, old_id[:12]):
        config["Hostname"] = old_hostname
    else:
        config.pop("Hostname", None)

    exposed: dict[str, Any] = {}
    for source in (new_image_config.get("ExposedPorts"), old_config.get("ExposedPorts")):
        if source:
            exposed.update(source)
    if exposed:
        config["ExposedPorts"] = exposed

    volumes: dict[str, Any] = {}
    for source in (new_image_config.get("Volumes"), old_config.get("Volumes")):
        if source:
            volumes.update(source)
    if volumes:
        config["Volumes"] = volumes
    else:
        config.pop("Volumes", None)

    host_config = copy.deepcopy(old_container.get("HostConfig") or {})
    host_config.pop("ContainerIDFile", None)
    # AutoRemove would remove the previous container before it can be restored.
    host_config["AutoRemove"] = False
    if not host_config.get("Binds"):
        binds = _binds_from_mounts(old_container.get("Mounts"))
        if binds:
            host_config["Binds"] = binds

    network_mode = str(host_config.get("NetworkMode") or "default")
    networking: dict[str, Any] = {}
    if (
        network_mode not in ("default", "bridge", "host", "none")
        and not network_mode.startswith("container:")
    ):
        endpoints: dict[str, Any] = {}
        networks = (old_container.get("NetworkSettings") or {}).get("Networks") or {}
        for name, data in networks.items():
            endpoint: dict[str, Any] = {}
            aliases = [
                alias
                for alias in (data.get("Aliases") or [])
                if alias not in (old_id, old_id[:12])
            ]
            if aliases:
                endpoint["Aliases"] = aliases
            if data.get("IPAMConfig"):
                endpoint["IPAMConfig"] = data["IPAMConfig"]
            endpoints[name] = endpoint
        if endpoints:
            networking["EndpointsConfig"] = endpoints

    payload = config
    payload["HostConfig"] = host_config
    if networking:
        payload["NetworkingConfig"] = networking
    return payload
