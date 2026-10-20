from app.updater.spec import merge_container_spec, merge_env


def test_env_merge_uses_new_image_defaults_and_keeps_container_overrides():
    old_env = ["PATH=/usr/bin", "HOMST_VERSION=0.2.0", "DATABASE_URL=postgres://db"]
    old_image_env = ["PATH=/usr/bin", "HOMST_VERSION=0.2.0"]
    new_image_env = ["PATH=/new/bin", "HOMST_VERSION=0.3.0"]

    merged = merge_env(old_env, old_image_env, new_image_env)
    assert "HOMST_VERSION=0.3.0" in merged
    assert "PATH=/new/bin" in merged
    assert "DATABASE_URL=postgres://db" in merged
    assert "HOMST_VERSION=0.2.0" not in merged


def test_spec_keeps_container_overrides_and_refreshes_image_defaults():
    old_container = {
        "Id": "abc1234567890",
        "Config": {
            "Hostname": "abc123456789",
            "Image": "ghcr.io/mrkprdo/homst:latest",
            "Env": ["PATH=/usr/bin", "HOMST_VERSION=0.2.0", "CUSTOM=1"],
            "Cmd": ["container-cmd"],
            "Entrypoint": ["container-entry"],
            "Labels": {
                "com.docker.compose.project": "homst-prod",
                "com.docker.compose.image": "sha256:old",
                "org.opencontainers.image.version": "0.2.0",
            },
            "ExposedPorts": {"8443/tcp": {}},
            "Volumes": {"/app/uploads": {}},
        },
        "HostConfig": {
            "Binds": ["homst-prod_photo_uploads:/app/uploads"],
            "PortBindings": {"8443/tcp": [{"HostPort": "8443"}]},
            "RestartPolicy": {"Name": "unless-stopped", "MaximumRetryCount": 0},
            "NetworkMode": "homst-prod_default",
            "AutoRemove": True,
        },
        "Mounts": [
            {
                "Type": "volume",
                "Name": "homst-prod_photo_uploads",
                "Destination": "/app/uploads",
                "RW": True,
            }
        ],
        "NetworkSettings": {
            "Networks": {
                "homst-prod_default": {
                    "Aliases": ["homst", "abc123456789"],
                    "IPAMConfig": None,
                }
            }
        },
    }
    old_image = {
        "Config": {
            "Env": ["PATH=/usr/bin", "HOMST_VERSION=0.2.0"],
            "Cmd": ["old-cmd"],
            "Entrypoint": ["old-entry"],
            "Labels": {"org.opencontainers.image.version": "0.2.0"},
            "ExposedPorts": {"8443/tcp": {}},
            "Volumes": {"/app/uploads": {}},
        }
    }
    new_image = {
        "Id": "sha256:new",
        "Config": {
            "Env": ["PATH=/new/bin", "HOMST_VERSION=0.3.0"],
            "Cmd": ["new-cmd"],
            "Entrypoint": ["new-entry"],
            "Labels": {"org.opencontainers.image.version": "0.3.0"},
            "ExposedPorts": {"8443/tcp": {}},
            "Volumes": {"/app/uploads": {}, "/app/cache": {}},
            "Healthcheck": {"Test": ["CMD", "true"]},
        }
    }

    payload = merge_container_spec(
        old_container, old_image, new_image, "ghcr.io/mrkprdo/homst:0.3.0", "0.3.0"
    )

    assert payload["Image"] == "ghcr.io/mrkprdo/homst:0.3.0"
    assert "HOMST_VERSION=0.3.0" in payload["Env"]
    assert "CUSTOM=1" in payload["Env"]
    assert payload["Cmd"] == ["container-cmd"]  # explicit container override wins
    assert payload["Entrypoint"] == ["container-entry"]
    assert payload["Labels"]["org.opencontainers.image.version"] == "0.3.0"
    assert payload["Labels"]["com.docker.compose.project"] == "homst-prod"
    assert payload["Labels"]["com.docker.compose.image"] == "sha256:new"
    assert payload["Labels"]["homst.managed"] == "true"
    assert payload["HostConfig"]["AutoRemove"] is False
    assert payload["HostConfig"]["RestartPolicy"]["Name"] == "unless-stopped"
    assert payload["HostConfig"]["PortBindings"]["8443/tcp"][0]["HostPort"] == "8443"
    assert "Hostname" not in payload
    assert payload["NetworkingConfig"]["EndpointsConfig"]["homst-prod_default"]["Aliases"] == [
        "homst"
    ]
    assert "/app/cache" in payload["Volumes"]


def test_spec_uses_new_image_command_when_container_did_not_override_it():
    old_container = {
        "Id": "abcdef123456",
        "Config": {
            "Image": "ghcr.io/mrkprdo/homst:latest",
            "Env": ["HOMST_VERSION=0.2.0"],
            "Cmd": ["old-cmd"],
            "Entrypoint": ["old-entry"],
        },
        "HostConfig": {},
    }
    old_image = {
        "Config": {
            "Env": ["HOMST_VERSION=0.2.0"],
            "Cmd": ["old-cmd"],
            "Entrypoint": ["old-entry"],
        }
    }
    new_image = {
        "Config": {
            "Env": ["HOMST_VERSION=0.3.0"],
            "Cmd": ["new-cmd"],
            "Entrypoint": ["new-entry"],
        }
    }
    payload = merge_container_spec(
        old_container, old_image, new_image, "ghcr.io/mrkprdo/homst:0.3.0", "0.3.0"
    )
    assert payload["Cmd"] == ["new-cmd"]
    assert payload["Entrypoint"] == ["new-entry"]
