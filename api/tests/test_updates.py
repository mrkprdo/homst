from app.updates import parse_releases


def _release(tag, draft=False, prerelease=False):
    return {
        "tag_name": tag,
        "draft": draft,
        "prerelease": prerelease,
        "name": tag,
        "published_at": "2026-01-01T00:00:00Z",
        "html_url": "https://example.com",
        "body": "",
    }


def test_parse_releases_keeps_only_stable_and_sorts_semver():
    releases = parse_releases(
        [
            _release("v0.2.0"),
            _release("v0.3.0-rc.1"),
            _release("v0.10.0"),
            _release("v0.9.0", draft=True),
            _release("v0.8.0", prerelease=True),
            _release("not-a-version"),
            _release("0.1.0"),
        ]
    )
    assert [release["version"] for release in releases] == [
        "0.10.0",
        "0.2.0",
        "0.1.0",
    ]
    assert all(release["tag"] == release["version"] for release in releases)
