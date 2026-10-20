"""Shared update/version policy helpers.

Used by both the HTTP API and the background update-check worker so the two
always agree on what counts as a managed stable install, which image tags are
eligible, and how often release checks run.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from packaging.version import InvalidVersion, Version

OFFICIAL_IMAGE_REPO = "ghcr.io/mrkprdo/homst"

DEFAULT_CHECK_INTERVAL_MINUTES = 5
MAX_CHECK_INTERVAL_MINUTES = 1440

ACTIVE_JOB_STATES = frozenset(
    {"queued", "pulling", "restarting", "verifying", "rolling_back"}
)


@dataclass(frozen=True)
class ImageRef:
    repo: str
    tag: str | None
    digest: str | None

    @classmethod
    def parse(cls, image: str | None) -> "ImageRef":
        value = (image or "").strip()
        if not value:
            return cls("", None, None)
        if "@" in value:
            repo, digest = value.split("@", 1)
            return cls(repo, None, digest)
        last_slash = value.rfind("/")
        last_colon = value.rfind(":")
        if last_colon > last_slash:
            return cls(value[:last_colon], value[last_colon + 1 :], None)
        return cls(value, "latest", None)


def parse_version(value: str | None) -> Version | None:
    if not value:
        return None
    try:
        return Version(str(value).lstrip("v"))
    except InvalidVersion:
        return None


def is_stable_version(value: str | None) -> bool:
    version = parse_version(value)
    return bool(version and not version.is_prerelease and not version.is_devrelease)


def is_newer(current: str | None, candidate: str | None) -> bool:
    cur = parse_version(current)
    new = parse_version(candidate)
    if not cur or not new:
        return False
    return new > cur


def is_major_update(current: str | None, candidate: str | None) -> bool:
    cur = parse_version(current)
    new = parse_version(candidate)
    if not cur or not new:
        return False
    return new.major != cur.major


def is_managed(
    target: dict[str, Any] | None,
    current_version: str,
    self_update_disabled: bool = False,
) -> tuple[bool, str | None]:
    """Return whether the running container may be updated from the UI."""

    if self_update_disabled:
        return False, "Self-update is disabled by configuration."
    if not target:
        return False, "The updater service is not running."

    ref = ImageRef.parse(target.get("image"))
    if ref.digest:
        return False, "This container runs from an image digest."
    if ref.tag and ref.tag.startswith("dev"):
        return False, "Nightly builds are updated manually."
    if ref.repo != OFFICIAL_IMAGE_REPO:
        return False, "This container uses a custom image."
    if not is_stable_version(current_version):
        return False, "This is a development build."

    labels = target.get("labels") or {}
    managed_label = str(labels.get("homst.managed", "")).lower() == "true"
    if ref.tag != "latest" and not managed_label:
        return False, "This install is pinned to a specific version."

    return True, None


def default_update_prefs() -> dict[str, Any]:
    return {
        "enabled": True,
        "checkIntervalMinutes": DEFAULT_CHECK_INTERVAL_MINUTES,
    }


def merge_update_prefs(raw: Any) -> dict[str, Any]:
    prefs = default_update_prefs()
    if not isinstance(raw, dict):
        return prefs

    if "enabled" in raw:
        prefs["enabled"] = bool(raw.get("enabled"))

    try:
        minutes = int(raw.get("checkIntervalMinutes"))
    except (TypeError, ValueError):
        minutes = DEFAULT_CHECK_INTERVAL_MINUTES
    if 1 <= minutes <= MAX_CHECK_INTERVAL_MINUTES:
        prefs["checkIntervalMinutes"] = minutes

    return prefs
