"""Minimal async Docker Engine API client over the Unix socket."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from typing import Any
from urllib.parse import quote

import httpx

logger = logging.getLogger("homst.updater.docker")


class DockerError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _quote(value: str) -> str:
    return quote(value, safe="")


class DockerClient:
    def __init__(self, socket_path: str):
        transport = httpx.AsyncHTTPTransport(uds=socket_path)
        self._client = httpx.AsyncClient(
            transport=transport,
            base_url="http://docker",
            timeout=httpx.Timeout(30.0, read=None),
            trust_env=False,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            response = await self._client.request(method, path, **kwargs)
        except Exception as exc:
            raise DockerError(503, f"Cannot reach the Docker daemon: {exc}") from exc
        if response.status_code >= 400:
            try:
                message = response.json().get("message") or response.text
            except Exception:
                message = response.text
            raise DockerError(response.status_code, message)
        return response

    async def ping(self) -> bool:
        response = await self._request("GET", "/_ping")
        return response.text.strip() == "OK"

    async def inspect_container(self, name: str) -> dict[str, Any]:
        response = await self._request("GET", f"/containers/{_quote(name)}/json")
        return response.json()

    async def inspect_image(self, ref: str) -> dict[str, Any]:
        response = await self._request("GET", f"/images/{_quote(ref)}/json")
        return response.json()

    async def pull_image(
        self,
        repo: str,
        tag: str,
        on_progress: Callable[[float, int, int, str], None] | None = None,
    ) -> None:
        async with self._client.stream(
            "POST",
            "/images/create",
            params={"fromImage": repo, "tag": tag},
        ) as response:
            if response.status_code >= 400:
                body = await response.aread()
                try:
                    message = json.loads(body).get("message") or body.decode()
                except Exception:
                    message = body.decode(errors="replace")
                raise DockerError(response.status_code, message)

            layers: dict[str, tuple[int, int]] = {}
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if event.get("error"):
                    raise DockerError(500, str(event["error"]))

                layer_id = event.get("id")
                detail = event.get("progressDetail") or {}
                current = detail.get("current")
                total = detail.get("total")
                if (
                    layer_id
                    and isinstance(current, (int, float))
                    and isinstance(total, (int, float))
                ):
                    layers[layer_id] = (int(current), int(total))
                elif layer_id and event.get("status") == "Pull complete":
                    layers[layer_id] = (1, 1)

                if on_progress:
                    downloaded = sum(current for current, _ in layers.values())
                    total_bytes = sum(total for _, total in layers.values())
                    percent = (downloaded / total_bytes * 100.0) if total_bytes else 0.0
                    on_progress(
                        min(percent, 100.0),
                        downloaded,
                        total_bytes,
                        str(event.get("status") or "Pulling image"),
                    )

    async def tag_image(self, ref: str, repo: str, tag: str) -> None:
        await self._request(
            "POST",
            f"/images/{_quote(ref)}/tag",
            params={"repo": repo, "tag": tag},
        )

    async def stop_container(self, container_id: str, timeout: int = 30) -> None:
        try:
            await self._request(
                "POST", f"/containers/{_quote(container_id)}/stop", params={"t": timeout}
            )
        except DockerError as exc:
            # 304 = already stopped
            if exc.status_code not in (304, 404):
                raise

    async def rename_container(self, container_id: str, name: str) -> None:
        await self._request(
            "POST", f"/containers/{_quote(container_id)}/rename", params={"name": name}
        )

    async def create_container(self, name: str, payload: dict[str, Any]) -> dict[str, Any]:
        response = await self._request(
            "POST", "/containers/create", params={"name": name}, json=payload
        )
        return response.json()

    async def start_container(self, container_id: str) -> None:
        try:
            await self._request("POST", f"/containers/{_quote(container_id)}/start")
        except DockerError as exc:
            if exc.status_code != 304:  # already started
                raise

    async def remove_container(self, container_id: str, force: bool = True) -> None:
        try:
            await self._request(
                "DELETE",
                f"/containers/{_quote(container_id)}",
                params={"force": "1" if force else "0", "v": "0"},
            )
        except DockerError as exc:
            if exc.status_code != 404:
                raise

    async def health_check(self, container_id: str) -> bool:
        """Exec the image's own health command inside the container."""

        command = (
            "import ssl, urllib.request; "
            "urllib.request.urlopen("
            "'https://127.0.0.1:8443/api/health', "
            "context=ssl._create_unverified_context(), timeout=4)"
        )
        try:
            response = await self._request(
                "POST",
                f"/containers/{_quote(container_id)}/exec",
                json={
                    "AttachStdout": False,
                    "AttachStderr": False,
                    "Tty": False,
                    "Cmd": ["python", "-c", command],
                },
            )
            exec_id = response.json()["Id"]
            await self._request(
                "POST",
                f"/exec/{_quote(exec_id)}/start",
                json={"Detach": True, "Tty": False},
            )
            for _ in range(10):
                info = (
                    await self._request("GET", f"/exec/{_quote(exec_id)}/json")
                ).json()
                if not info.get("Running"):
                    return info.get("ExitCode") == 0
                await asyncio.sleep(0.5)
        except Exception as exc:
            logger.debug("Health exec failed: %s", exc)
        return False
