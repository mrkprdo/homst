from app.system_state import (
    ImageRef,
    is_major_update,
    is_managed,
    is_newer,
    merge_update_prefs,
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
    assert merge_update_prefs({}) == {
        "enabled": True,
        "checkIntervalMinutes": 5,
    }
    prefs = merge_update_prefs({"enabled": False, "checkIntervalMinutes": 15})
    assert prefs == {
        "enabled": False,
        "checkIntervalMinutes": 15,
    }

    # Invalid intervals fall back to the 5-minute default.
    assert merge_update_prefs({"checkIntervalMinutes": 0})["checkIntervalMinutes"] == 5
    assert merge_update_prefs({"checkIntervalMinutes": "nope"})["checkIntervalMinutes"] == 5
    assert merge_update_prefs({"checkIntervalMinutes": 9999})["checkIntervalMinutes"] == 5

    # Old maintenance-window keys are ignored.
    assert merge_update_prefs(
        {"windowStart": "23:30", "windowEnd": "05:00", "allowMajor": True}
    ) == {"enabled": True, "checkIntervalMinutes": 5}
