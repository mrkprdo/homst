from datetime import datetime, timedelta, timezone

from app.updates import _feed_from_cache, mature_releases, parse_releases


def _release(tag, draft=False, prerelease=False, published_at="2026-01-01T00:00:00Z"):
    return {
        "tag_name": tag,
        "draft": draft,
        "prerelease": prerelease,
        "name": tag,
        "published_at": published_at,
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


def test_recent_releases_are_held_back_for_a_day():
    now = datetime(2026, 5, 10, 12, 0, tzinfo=timezone.utc)
    releases = [
        {"version": "0.3.0", "published_at": (now - timedelta(hours=23)).isoformat()},
        {"version": "0.2.0", "published_at": (now - timedelta(hours=24)).isoformat()},
    ]

    assert mature_releases(releases, now=now) == [releases[1]]


def test_releases_without_a_usable_publication_date_are_not_delayed():
    releases = [{"published_at": None}, {"published_at": "not-a-date"}]

    assert mature_releases(releases, now=datetime.now(timezone.utc)) == releases


def test_cached_feed_applies_grace_period_when_read():
    now = datetime.now(timezone.utc)
    cached = {
        "releases": [
            {"version": "0.3.0", "published_at": now.isoformat()},
            {
                "version": "0.2.0",
                "published_at": (now - timedelta(days=2)).isoformat(),
            },
        ],
        "checked_at": now.timestamp(),
    }

    feed = _feed_from_cache(cached)

    assert [release["version"] for release in feed.releases] == ["0.2.0"]
