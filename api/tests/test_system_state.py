from datetime import datetime
from zoneinfo import ZoneInfo

from app.system_state import (
    ImageRef,
    is_major_update,
    is_managed,
    is_newer,
    merge_update_prefs,
    update_window_open,
)


def test_image_ref_parsing():
    assert ImageRef.parse("ghcr.io/mrkprdo/homst:latest") == ImageRef(
        "ghcr.io/mrkprdo/homst", "latest", None
    )
    assert ImageRef.parse("ghcr.io/mrkprdo/homst:0.2.0") == ImageRef(
        "ghcr.io/mrkprdo/homst", "0.2.0", None
    )
    assert ImageRef.parse("ghcr.io/mrkprdo/homst") == ImageRef(
        "ghcr.io/mrkprdo/homst", "latest", None
    )
    digest = "sha256:" + "a" * 64
    assert ImageRef.parse(f"ghcr.io/mrkprdo/homst@{digest}") == ImageRef(
        "ghcr.io/mrkprdo/homst", None, digest
    )


def test_version_comparison():
    assert is_newer("0.2.0", "0.3.0")
    assert is_newer("0.9.0", "0.10.0")
    assert not is_newer("0.3.0", "0.3.0")
    assert not is_newer("dev", "0.3.0")
    assert is_major_update("0.3.0", "1.0.0")
    assert not is_major_update("0.2.0", "0.3.0")


def test_managed_requires_official_latest_or_managed_label():
    target = {"image": "ghcr.io/mrkprdo/homst:latest", "labels": {}}
    assert is_managed(target, "0.2.0")[0]

    pinned = {"image": "ghcr.io/mrkprdo/homst:0.2.0", "labels": {}}
    assert not is_managed(pinned, "0.2.0")[0]

    rolled_back = {
        "image": "ghcr.io/mrkprdo/homst:0.2.0",
        "labels": {"homst.managed": "true"},
    }
    assert is_managed(rolled_back, "0.2.0")[0]

    nightly = {"image": "ghcr.io/mrkprdo/homst:dev", "labels": {}}
    assert not is_managed(nightly, "dev")[0]

    custom = {"image": "ghcr.io/example/homst:latest", "labels": {}}
    assert not is_managed(custom, "0.2.0")[0]


def test_update_prefs_validation():
    prefs = merge_update_prefs(
        {"enabled": False, "windowStart": "23:30", "windowEnd": "05:00", "allowMajor": True}
    )
    assert prefs == {
        "enabled": False,
        "windowStart": "23:30",
        "windowEnd": "05:00",
        "allowMajor": True,
    }
    # Invalid times fall back to the defaults.
    assert merge_update_prefs({"windowStart": "nope"})["windowStart"] == "03:00"


def test_update_window_day_and_overnight():
    tz = ZoneInfo("UTC")
    day = {"enabled": True, "windowStart": "03:00", "windowEnd": "05:00"}
    assert update_window_open(day, "UTC", datetime(2026, 1, 1, 4, 0, tzinfo=tz))
    assert not update_window_open(day, "UTC", datetime(2026, 1, 1, 6, 0, tzinfo=tz))

    overnight = {"enabled": True, "windowStart": "23:00", "windowEnd": "05:00"}
    assert update_window_open(overnight, "UTC", datetime(2026, 1, 1, 23, 30, tzinfo=tz))
    assert update_window_open(overnight, "UTC", datetime(2026, 1, 2, 4, 0, tzinfo=tz))
    assert not update_window_open(overnight, "UTC", datetime(2026, 1, 2, 12, 0, tzinfo=tz))
