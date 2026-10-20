"""
Multicast DNS service broadcaster for HOMST.

Broadcasts a _homst._tcp.local. service so local-network clients
can discover the HOMST API without manual URL configuration.

Requires the ``zeroconf`` package:  pip install zeroconf
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import socket

from app.version import VERSION

try:
    from zeroconf import ServiceInfo, Zeroconf
    _ZEROCONF_AVAILABLE = True
except ImportError:
    _ZEROCONF_AVAILABLE = False


class HOMSTmDNS:
    """Manages mDNS service registration for the HOMST API."""

    def __init__(
        self,
        instance_name: str = "HOMST",
        port: int = 8000,
        *,
        host: str | None = None,
        api_prefix: str = "/api",
    ):
        self.instance_name = instance_name
        self._port = port
        self._host = host or self._local_ip()
        self._api_prefix = api_prefix
        self._zc: "Zeroconf | None" = None
        self._info: "ServiceInfo | None" = None

    @staticmethod
    def _local_ip() -> str:
        """Resolve the primary local (non-loopback) IP address."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                # 8.8.8.8 won't actually be reached — we just need the route
                s.connect(("8.8.8.8", 80))
                return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"

    def _start_sync(self) -> None:
        """Synchronous registration — runs in a thread to avoid blocking the event loop."""
        props: dict[str, str] = {
            "version": VERSION,
            "api": self._api_prefix,
            "host": self._host,
        }

        svc_type = "_homst._tcp.local."
        secret = os.getenv("SECRET_KEY", "homst")
        suffix = hashlib.md5(secret.encode()).hexdigest()[:6]
        server_name = f"{self.instance_name}-{suffix} ({self._host}).{svc_type}"

        self._info = ServiceInfo(
            type_=svc_type,
            name=server_name,
            addresses=[socket.inet_aton(self._host)],
            port=self._port,
            properties=props,
            server="homst.local.",
        )

        self._zc = Zeroconf()
        self._zc.register_service(self._info)
        print(f"[mDNS] Broadcasting {server_name}:{self._port}")

    async def start(self) -> None:
        """Register the HOMST service on the local network via mDNS."""
        if self._zc is not None:
            return

        if not _ZEROCONF_AVAILABLE:
            print("[mDNS] zeroconf not installed — skipping broadcast")
            return

        try:
            await asyncio.to_thread(self._start_sync)
        except Exception as e:
            print(f"[mDNS] Failed to register: {e}")

    def _stop_sync(self) -> None:
        """Synchronous unregister — runs in a thread."""
        if self._zc is None:
            return
        self._zc.unregister_service(self._info)
        self._zc.close()
        self._zc = None
        self._info = None

    async def stop(self) -> None:
        """Unregister and clean up mDNS."""
        if self._zc is None:
            return
        print("[mDNS] Stopping broadcast")
        await asyncio.to_thread(self._stop_sync)


# Singleton for the FastAPI lifespan
homst_mdns = HOMSTmDNS()


