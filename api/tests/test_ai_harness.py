"""Control-flow tests for HOMST's Smart Event Assistant.

Covers clarification rounds, member resolution, question normalisation and
deterministic schedule-conflict detection. The outbound model call is faked;
the router tests use the real in-memory database.
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app import ai
from app.config import settings
from tests.test_ai import (
    completion,
    configure,
    fake_client,
    fake_stream_client,
)

TZ = timezone.utc
MEMBERS = [("m-alice", "Alice Smith"), ("m-bob", "Bob")]
CONFIG = {"api_key": "k", "provider": "console", "model": ai.DEFAULT_MODEL}


def draft(
    title: str,
    start: str,
    end: str | None = None,
    *,
    all_day: bool = False,
    assignee_id: str | None = None,
) -> dict:
    return {
        "title": title,
        "start_at": start,
        "end_at": end,
        "all_day": all_day,
        "assignee_id": assignee_id,
    }


# ── Persona ────────────────────────────────────────────────────────────────


def test_system_prompt_identifies_as_smart_event_assistant():
    prompt = ai._system_prompt(
        datetime(2027, 1, 5, 9, tzinfo=TZ), "UTC", ["Alice Smith"], has_image=False
    )
    assert prompt.startswith("I'm HOMST's Smart Event Assistant.")
    assert prompt.count("I'm HOMST's Smart Event Assistant.") >= 2
    assert "Do not repeat the introduction" in prompt
    assert '"updates"' in prompt
    assert '"deletes"' in prompt
    assert '"actions"' in prompt
    assert "Rules for actions" in prompt
    assert "Rules for changing and deleting existing events" in prompt
    assert "__TZ__" not in prompt


def test_turn_actions_are_validated_and_deduplicated():
    assert ai._coerce_actions(None) == []
    assert ai._coerce_actions("done") == []
    assert ai._coerce_actions(["done", "bogus", "add_manually", "done"]) == [
        "done",
        "add_manually",
    ]
    assert ai._coerce_actions(["add_another", "done", "add_manually", "done"]) == [
        "add_another",
        "done",
        "add_manually",
    ]


# ── Members ────────────────────────────────────────────────────────────────


def test_member_aliases_lookup_and_line():
    assert ai._member_aliases("") == []
    assert ai._member_aliases("Mom") == ["mom"]
    assert ai._member_aliases("Alice Smith") == ["alice smith", "alice"]
    assert ai._member_aliases("J. R. Smith") == ["j. r. smith", "j."]

    assert ai._member_line([]) == "none"
    assert ai._member_line(["", "   "]) == "none"
    assert ai._member_line(["Alice Smith", "Mom"]) == "Alice Smith (Alice), Mom"

    lookup = ai._member_lookup(
        [("1", "Alice Smith"), ("2", "Alice Jones"), ("3", "Bob")]
    )
    # A shared first name is not safe to resolve.
    assert "alice" not in lookup
    assert lookup["alice smith"] == "1"
    assert lookup["bob"] == "3"
    assert ai._member_lookup([("1", "Alex"), ("2", "Alex")]) == {}


def test_resolve_and_infer_assignee():
    assert ai._resolve_assignee(None, MEMBERS) is None
    assert ai._resolve_assignee("   ", MEMBERS) is None
    assert ai._resolve_assignee("alice", MEMBERS) == "m-alice"
    assert ai._resolve_assignee("Alice Smith", MEMBERS) == "m-alice"
    assert ai._resolve_assignee("Alice Smith's", MEMBERS) == "m-alice"
    assert ai._resolve_assignee("Uncle Joe", MEMBERS) is None
    assert ai._resolve_assignee("Alice", [("1", "Alice"), ("2", "Alice")]) is None

    assert ai._infer_assignee(None, MEMBERS) is None
    assert ai._infer_assignee("", MEMBERS) is None
    assert ai._infer_assignee("Football practice", MEMBERS) is None
    assert ai._infer_assignee("Alice Smith's review", MEMBERS) == "m-alice"
    assert ai._infer_assignee("dinner for Bob", MEMBERS) == "m-bob"


def test_validate_event_resolves_and_flags_assignees():
    start = "2027-01-05T09:00:00Z"
    event, _, issues = ai._validate_event(
        {
            "title": "Soccer",
            "start_at": start,
            "assignee": "Uncle Joe",
            "confidence": 0.9,
        },
        TZ,
        MEMBERS,
    )
    assert event["assignee_id"] is None
    assert issues and "isn't a household member" in issues[0]
    assert event["confidence"] == 0.4

    inferred, _, issues = ai._validate_event(
        {"title": "Bob's game", "start_at": start, "confidence": 0.9},
        TZ,
        MEMBERS,
    )
    assert inferred["assignee_id"] == "m-bob"
    assert issues == []

    # A clear title beats an unusable assignee value.
    recovered, _, issues = ai._validate_event(
        {
            "title": "Bob's game",
            "start_at": start,
            "assignee": "Uncle Joe",
            "confidence": 0.9,
        },
        TZ,
        MEMBERS,
    )
    assert recovered["assignee_id"] == "m-bob"
    assert issues == []

    # Non-string assignee values are simply ignored.
    plain, _, _ = ai._validate_event(
        {"title": "Practice", "start_at": start, "assignee": 42}, TZ, MEMBERS
    )
    assert plain["assignee_id"] is None


# ── Questions and clarifications ───────────────────────────────────────────


def test_normalize_questions_caps_dedupes_and_skips_answered():
    raw = [
        "not a question",
        {"question": 5},
        {"question": "   "},
        {
            "question": "  Which Alice?  ",
            "kind": "nonsense",
            "options": ["Alice", 5, "alice", "A" * 200],
            "about": "  Party  ",
        },
        {"question": "which alice?"},
        {"question": "When is it?", "options": "nope"},
        {"question": "Who is it for?", "kind": "assignee"},
        {"question": "Many options?", "options": [f"option {n}" for n in range(10)]},
        {"question": "Third question?", "kind": "conflict"},
        {"question": "Fourth question?", "kind": "clarification"},
    ]
    questions = ai._normalize_questions(raw, MEMBERS)
    assert len(questions) == ai.MAX_QUESTIONS
    assert [q["id"] for q in questions] == ["q1", "q2", "q3"]
    assert questions[0]["kind"] == "clarification"
    assert questions[0]["options"] == ["Alice", "A" * ai.MAX_OPTION_CHARS]
    assert questions[0]["about"] == "Party"
    assert questions[1]["question"] == "When is it?"
    assert questions[1]["kind"] == "datetime"
    assert questions[1]["options"] == []
    assert questions[2]["kind"] == "assignee"
    assert questions[2]["question"] == "Who is it for?"
    assert questions[2]["options"] == ["Alice Smith", "Bob"]

    many = ai._normalize_questions(
        [{"question": "Many?", "options": [f"option {n}" for n in range(10)]}],
        MEMBERS,
    )
    assert many[0]["options"] == [f"option {n}" for n in range(ai.MAX_QUESTION_OPTIONS)]

    datetime_question = ai._normalize_questions(
        [
            {
                "question": "What date and time is the dog's neuter appointment?",
                "kind": "datetime",
                "options": ["Tomorrow morning", "This week"],
            }
        ],
        MEMBERS,
    )
    assert datetime_question[0]["kind"] == "datetime"
    assert datetime_question[0]["options"] == []

    assert ai._normalize_questions("nope", MEMBERS) == []

    answered = ai._normalize_questions(
        [{"question": "When is it?"}],
        MEMBERS,
        [{"question": "when is it?", "answer": "Friday"}],
    )
    assert answered == []


def test_answered_questions_ignores_bad_entries():
    assert ai._answered_questions(None) == set()
    assert ai._answered_questions(["nope", {"question": 5}, {}]) == set()
    assert ai._answered_questions(
        [{"question": " Which day? ", "answer": "Friday"}]
    ) == {"which day?"}


def test_clarification_text_and_user_content():
    assert ai._clarification_text(None) == ""
    assert ai._clarification_text(["nope", {"question": 5, "answer": "x"}]) == ""
    assert ai._clarification_text(
        [{"question": "Hi", "answer": "x"}, {"question": "Where?", "answer": "  "}]
    ) == ""

    text = ai._clarification_text(
        [
            {"question": "Which day?", "answer": "Friday"},
            {"question": "Who?", "answer": "Alice"},
        ]
    )
    assert "Q: Which day?" in text
    assert "A: Friday" in text
    assert "complete event list" in text

    capped = ai._clarification_text(
        [
            {"question": f"Question number {index}?", "answer": "yes"}
            for index in range(ai.MAX_CLARIFICATIONS + 4)
        ]
    )
    assert f"Question number {ai.MAX_CLARIFICATIONS - 1}?" in capped
    assert f"Question number {ai.MAX_CLARIFICATIONS}?" not in capped

    plain = ai._user_content("Dinner", None, [{"question": "Day?", "answer": "Fri"}])
    assert "Dinner" in plain
    assert "Q: Day?" in plain

    parts = ai._user_content(
        "", "data:image/png;base64,abc", [{"question": "Day?", "answer": "Fri"}]
    )
    assert parts[0]["type"] == "text"
    assert "Extract the schedule from this image." in parts[0]["text"]
    assert "Q: Day?" in parts[0]["text"]
    assert parts[1]["type"] == "image_url"


def test_validate_payload_ex_collects_questions_warnings_and_conflicts():
    payload = {
        "events": [
            {
                "title": "Soccer",
                "start_at": "2027-01-05T09:00:00Z",
                "assignee": "Uncle Joe",
                "confidence": 0.9,
            },
            {
                "title": "Dentist",
                "start_at": "2027-01-06T09:00:00Z",
                "assignee": "Aunt May",
                "confidence": 0.9,
            },
        ],
        "questions": [{"question": "Is the year 2027?"}],
    }
    drafts, skipped, warnings, questions, conflicts = ai.validate_payload_ex(
        payload, TZ, MEMBERS
    )
    assert len(drafts) == 2
    assert skipped == 0
    assert conflicts == []
    assert questions[0]["question"] == "Is the year 2027?"
    assert [q["kind"] for q in questions] == ["clarification", "assignee", "assignee"]
    assert (
        "2 people aren't in the household. Pick who those events are for."
        in warnings
    )

    single = {
        "events": [
            {
                "title": "Soccer",
                "start_at": "2027-01-05T09:00:00Z",
                "assignee": "Uncle Joe",
            }
        ]
    }
    *_, single_questions, _ = ai.validate_payload_ex(single, TZ, MEMBERS)
    assert len(single_questions) == 1
    assert "1 person isn't" in ai.validate_payload_ex(single, TZ, MEMBERS)[2][0]

    assert ai.validate_payload({"events": []}, TZ, MEMBERS) == ([], 0, [])


# ── Conflicts ──────────────────────────────────────────────────────────────


def test_conflict_detection_respects_owners_and_drafts():
    busy = [
        {
            "id": "ev-dentist",
            "title": "Dentist",
            "start_at": "2027-01-05T09:30:00Z",
            "end_at": "2027-01-05T10:30:00Z",
            "assignee_id": "m-alice",
            "assignee": "Alice",
            "recurrence": None,
        },
        {
            "title": "Bob's shift",
            "start_at": "2027-01-05T11:30:00Z",
            "end_at": "2027-01-05T12:30:00Z",
            "assignee_id": "m-bob",
            "assignee": "Bob",
            "recurrence": None,
        },
        {
            "title": "Household repair",
            "start_at": "2027-01-05T13:30:00Z",
            "end_at": "2027-01-05T14:30:00Z",
            "assignee_id": None,
            "assignee": None,
            "recurrence": None,
        },
    ]
    drafts = [
        draft("Standup", "2027-01-05T09:00:00Z", "2027-01-05T10:00:00Z", assignee_id="m-alice"),
        draft("Bob's game", "2027-01-05T11:00:00Z", "2027-01-05T12:00:00Z", assignee_id="m-bob"),
        draft("Repair", "2027-01-05T13:00:00Z", "2027-01-05T14:00:00Z"),
        draft(
            "Unrelated",
            "2027-01-05T11:00:00Z",
            "2027-01-05T12:00:00Z",
            assignee_id="m-alice",
        ),
    ]
    conflicts = ai._find_conflicts(drafts, busy, TZ)
    assert len(conflicts) == 3
    assert conflicts[0]["draft_index"] == 0
    assert conflicts[0]["existing_title"] == "Dentist"
    assert conflicts[0]["existing_event_id"] == "ev-dentist"
    assert conflicts[1]["draft_index"] == 1
    assert conflicts[1]["existing_title"] == "Bob's shift"
    assert conflicts[2]["draft_index"] == 2
    assert conflicts[2]["existing_title"] == "Household repair"
    assert conflicts[0]["message"].startswith('"Standup" overlaps "Dentist"')
    # Two different named members can be busy at the same time.
    assert all(c["draft_index"] != 3 for c in conflicts)


def test_household_wide_events_conflict_with_member_events():
    busy = [
        {
            "title": "Dentist",
            "start_at": "2027-01-05T10:00:00Z",
            "end_at": "2027-01-05T11:00:00Z",
            "assignee_id": "m-alice",
        }
    ]
    unassigned = ai._find_conflicts(
        [draft("Family lunch", "2027-01-05T10:00:00Z", "2027-01-05T11:00:00Z")],
        busy,
        TZ,
    )
    assert len(unassigned) == 1
    other_member = ai._find_conflicts(
        [
            draft(
                "Bob's game",
                "2027-01-05T10:00:00Z",
                "2027-01-05T11:00:00Z",
                assignee_id="m-bob",
            )
        ],
        busy,
        TZ,
    )
    assert other_member == []


def test_conflict_detection_handles_all_day_drafts_and_duplicates():
    busy = [
        {
            "title": "Trip",
            "start_at": "2027-01-05T00:00:00Z",
            "end_at": None,
            "all_day": True,
            "assignee_id": None,
        }
    ]
    drafts = [
        draft("Appointment", "2027-01-05T14:00:00Z", "2027-01-05T15:00:00Z"),
        draft("Second appointment", "2027-01-05T14:00:00Z", "2027-01-05T15:00:00Z"),
    ]
    conflicts = ai._find_conflicts(drafts, busy, TZ)
    # Each draft hits the all-day trip, and the two drafts hit each other.
    assert len(conflicts) == 3
    assert {c["existing_kind"] for c in conflicts} == {"existing", "draft"}
    assert all("(all day)" in conflicts[index]["message"] for index in (0, 1))
    assert "(all day)" not in conflicts[2]["message"]

    assert ai._find_conflicts([], busy, TZ) == []
    assert ai._find_conflicts([draft("Bad", "nope")], busy, TZ) == []


def test_conflict_detection_caps_results():
    busy = [
        {
            "title": f"Existing {index}",
            "start_at": "2027-01-05T09:00:00Z",
            "end_at": "2027-01-05T10:00:00Z",
            "assignee_id": None,
        }
        for index in range(ai.MAX_CONFLICTS + 5)
    ]
    drafts = [
        draft("One", "2027-01-05T09:30:00Z", "2027-01-05T10:30:00Z"),
        draft("Two", "2027-01-05T09:30:00Z", "2027-01-05T10:30:00Z"),
    ]
    conflicts = ai._find_conflicts(drafts, busy, TZ)
    assert len(conflicts) == ai.MAX_CONFLICTS


def test_interval_and_owner_helpers():
    start = datetime(2027, 1, 5, 9, 0, tzinfo=timezone.utc)
    assert ai._interval(start, None, False)[1] == start + timedelta(hours=1)
    assert ai._interval(start, start, False)[1] == start + timedelta(hours=1)
    assert ai._interval(start, None, True)[1] == start + timedelta(days=1)
    assert ai._interval(start, start, True)[1] == start + timedelta(days=1)

    assert ai._owners_overlap(None, None) is True
    assert ai._owners_overlap("a", "a") is True
    assert ai._owners_overlap("a", "b") is False
    assert ai._owners_overlap("a", None) is True
    assert ai._owners_overlap(None, "a") is True


def test_busy_intervals_and_prompt_lines():
    assert (
        ai._busy_intervals(
            [],
            TZ,
            datetime(2027, 1, 1, tzinfo=TZ),
            datetime(2027, 2, 1, tzinfo=TZ),
        )
        == []
    )
    intervals = ai._busy_intervals(
        [
            "nope",
            {"title": "Bad", "start_at": "nope"},
            {
                "title": "Weekly swim",
                "start_at": "2027-01-04T09:00:00Z",
                "end_at": "2027-01-04T10:00:00Z",
                "recurrence": {"freq": "weekly"},
            },
            {
                "title": None,
                "start_at": "2027-01-06T09:00:00Z",
                "all_day": True,
            },
        ],
        TZ,
        datetime(2027, 1, 1, tzinfo=TZ),
        datetime(2027, 1, 20, tzinfo=TZ),
    )
    # Three weekly swims plus the unnamed all-day row.
    assert len(intervals) == 4
    assert intervals[0]["title"] == "Weekly swim"
    assert intervals[-1]["title"] == "Untitled"
    assert intervals[-1]["end"] - intervals[-1]["start"] == timedelta(days=1)

    assert ai._format_busy(None, TZ) == "none"
    assert ai._format_busy([], TZ) == "none"
    assert ai._format_busy(["nope", {"start_at": "nope"}], TZ) == "none"
    prompt = ai._format_busy(
        [
            {
                "title": "Dentist",
                "start_at": "2027-01-05T14:00:00Z",
                "end_at": "2027-01-05T15:00:00Z",
                "assignee": "Alice",
                "recurrence": {"freq": "monthly"},
            },
            {"title": 42, "start_at": "2027-01-06T09:00:00Z"},
        ],
        TZ,
    )
    assert "Dentist" in prompt
    assert "Alice" in prompt
    assert "repeats monthly" in prompt
    assert "household" in prompt
    assert "Untitled" in prompt


CATALOG = [
    {
        "ref": 1,
        "id": "11111111-1111-1111-1111-111111111111",
        "title": "Dentist",
        "start_at": "2027-01-05T09:00:00+00:00",
        "end_at": "2027-01-05T10:00:00+00:00",
        "all_day": False,
        "assignee_id": "m1",
        "assignee": "Alice",
        "recurrence": None,
        "reminder_minutes": 30,
        "external": False,
    },
    {
        "ref": 2,
        "id": "22222222-2222-2222-2222-222222222222",
        "title": "Swim",
        "start_at": "2027-01-06T09:00:00+00:00",
        "end_at": None,
        "all_day": True,
        "assignee_id": None,
        "assignee": None,
        "recurrence": {"freq": "weekly"},
        "reminder_minutes": None,
        "external": True,
    },
]


def test_validate_actions_updates_and_deletes():
    updates, deletes, warnings = ai.validate_actions(
        {
            "updates": [{"ref": 1, "start_at": "2027-01-05T15:00:00Z"}],
            "deletes": [{"ref": 2, "reason": "Cancelled"}],
        },
        CATALOG,
        TZ,
        MEMBERS,
    )
    assert warnings == []
    assert len(updates) == 1
    update = updates[0]
    assert update["event_id"] == CATALOG[0]["id"]
    assert update["title"] == "Dentist"
    # Moving an event without a new end keeps its one-hour duration.
    assert update["changes"]["start_at"] == "2027-01-05T15:00:00+00:00"
    assert update["changes"]["end_at"] == "2027-01-05T16:00:00+00:00"
    assert "title" not in update["changes"]
    assert len(deletes) == 1
    assert deletes[0]["event_id"] == CATALOG[1]["id"]
    assert deletes[0]["external"] is True


def test_validate_actions_clears_fields_and_rejects_bad_refs():
    updates, deletes, warnings = ai.validate_actions(
        {
            "updates": [
                {
                    "ref": 1,
                    "reminder_minutes": None,
                    "assignee": None,
                    "recurrence": None,
                },
                {"ref": 99, "title": "Ghost"},
                {"ref": 2, "title": "Renamed swim"},
            ],
            "deletes": [{"ref": 1}, {"ref": 98}],
        },
        CATALOG,
        TZ,
        MEMBERS,
    )
    assert [item["ref"] for item in deletes] == [1]
    assert len(warnings) >= 2
    # A ref cannot be updated and deleted in the same answer.
    assert [item["ref"] for item in updates] == [2]
    assert any("isn't in the calendar" in note for note in warnings)
    assert any("also being deleted" in note for note in warnings)

    updates, _, _ = ai.validate_actions(
        {
            "updates": [
                {
                    "ref": 1,
                    "reminder_minutes": None,
                    "assignee": None,
                    "recurrence": None,
                }
            ]
        },
        CATALOG,
        TZ,
        MEMBERS,
    )
    assert updates[0]["changes"] == {
        "reminder_minutes": None,
        "assignee_id": None,
    }


def test_validate_actions_focus_mode_and_external():
    _, _, warnings = ai.validate_actions(
        {"updates": [{"ref": 1, "title": "Nope"}]},
        CATALOG,
        TZ,
        MEMBERS,
        allowed=False,
    )
    assert warnings

    updates, _, warnings = ai.validate_actions(
        {"updates": [{"ref": 2, "title": "Moved swim"}]},
        CATALOG,
        TZ,
        MEMBERS,
    )
    assert warnings == []
    assert updates[0]["external"] is True
    assert updates[0]["changes"]["title"] == "Moved swim"


def test_validate_payload_ex_accepts_a_pure_command():
    drafts, skipped, warnings, questions, conflicts = ai.validate_payload_ex(
        {
            "events": [],
            "updates": [{"ref": 1, "title": "Dentist"}],
        },
        TZ,
        MEMBERS,
    )
    assert drafts == []
    assert skipped == 0
    assert warnings == []
    assert questions == []
    assert conflicts == []


def test_recurrence_expansion_edges():
    start = datetime(2027, 1, 4, 9, 0, tzinfo=TZ)
    assert ai._recurrence_starts({"freq": "hourly"}, start, start, start) == [start]

    daily = ai._recurrence_starts(
        {"freq": "daily", "count": 3},
        start,
        start,
        start + timedelta(days=10),
    )
    assert daily == [start, start + timedelta(days=1), start + timedelta(days=2)]

    weekly = ai._recurrence_starts(
        {"freq": "weekly", "until": (start + timedelta(days=14)).isoformat()},
        start,
        start + timedelta(days=10),
        start + timedelta(days=30),
    )
    assert weekly == [start + timedelta(days=14)]

    biweekly = ai._recurrence_starts(
        {"freq": "biweekly"}, start, start, start + timedelta(days=30)
    )
    assert biweekly == [start, start + timedelta(days=14), start + timedelta(days=28)]

    monthly = ai._recurrence_starts(
        {"freq": "monthly"}, start, start, start + timedelta(days=70)
    )
    assert monthly == [start, start.replace(month=2), start.replace(month=3)]

    yearly = ai._recurrence_starts(
        {"freq": "yearly"}, start, start, start.replace(year=2029)
    )
    assert yearly == [start, start.replace(year=2028), start.replace(year=2029)]

    # Malformed count/until values fall back to safe bounds.
    bounded = ai._recurrence_starts(
        {"freq": "daily", "count": "nope", "until": "nope"},
        start,
        start,
        start + timedelta(days=1),
    )
    assert bounded == [start, start + timedelta(days=1)]

    assert ai._recurrence_starts(
        {"freq": "weekly", "count": 0},
        start,
        start,
        start + timedelta(days=30),
    ) == [start]
    assert ai._shift_occurrence(start, "hourly") is None
    assert ai._add_months(datetime(2027, 1, 31, tzinfo=TZ), 1) == datetime(
        2027, 2, 28, tzinfo=TZ
    )


def test_recurrence_stops_when_stepping_fails(monkeypatch):
    start = datetime(2027, 1, 4, 9, 0, tzinfo=TZ)
    monkeypatch.setattr(ai, "_shift_occurrence", lambda moment, freq: None)
    assert ai._recurrence_starts(
        {"freq": "weekly"}, start, start, start + timedelta(days=7)
    ) == [start]


def test_find_conflicts_skips_unparseable_drafts():
    drafts = [
        draft("Good", "2027-01-05T09:00:00Z", "2027-01-05T10:00:00Z"),
        draft("Bad", "not-a-date"),
    ]
    assert ai._find_conflicts(drafts, None, TZ) == []


# ── Request building ───────────────────────────────────────────────────────


def test_parse_schedule_sends_members_busy_and_clarifications(monkeypatch):
    captured = fake_client(monkeypatch, response=completion('{"events": []}'))
    result = asyncio.run(
        ai.parse_schedule(
            CONFIG,
            text="Soccer tryouts",
            image=None,
            tz=TZ,
            tz_label="UTC",
            members=MEMBERS,
            busy=[
                {
                    "title": "Dentist",
                    "start_at": "2027-01-05T14:00:00Z",
                    "end_at": "2027-01-05T15:00:00Z",
                    "assignee_id": "m-alice",
                    "assignee": "Alice Smith",
                }
            ],
            clarifications=[{"question": "Which day?", "answer": "Friday"}],
        )
    )
    system = captured["json"]["messages"][0]["content"]
    user = captured["json"]["messages"][1]["content"]
    assert "Alice Smith (Alice)" in system
    assert "Dentist" not in system
    assert "Dentist" in user
    assert "Current calendar" in user
    assert "Q: Which day?" in user
    assert result["needs_input"] is False
    assert result["questions"] == []
    assert result["conflicts"] == []


def test_stream_schedule_sends_clarifications_and_returns_questions(monkeypatch):
    content = json.dumps(
        {
            "events": [
                {
                    "title": "Practice",
                    "start_at": "2027-01-05T09:00:00Z",
                    "assignee": "Uncle Joe",
                }
            ],
            "questions": [{"question": "Who is this for?"}],
        }
    )
    lines = [f'data: {json.dumps({"choices": [{"delta": {"content": content}}]})}', "data: [DONE]"]
    captured = fake_stream_client(monkeypatch, lines=lines)
    events = asyncio.run(
        _collect(
            ai.stream_schedule(
                CONFIG,
                text="Practice",
                image=None,
                tz=TZ,
                tz_label="UTC",
                members=MEMBERS,
                clarifications=[{"question": "Which day?", "answer": "Friday"}],
            )
        )
    )
    result = events[-1]
    assert result["questions"][0]["question"] == "Who is this for?"
    assert result["questions"][1]["kind"] == "assignee"
    assert result["needs_input"] is True
    assert "Q: Which day?" in captured["json"]["messages"][1]["content"]


def test_history_is_forwarded_and_reply_is_cleaned(monkeypatch):
    content = json.dumps(
        {
            "reply": "  I found   two events.\nCheck the times. ",
            "events": [
                {"title": "Practice", "start_at": "2027-01-05T09:00:00Z"},
                {"title": "Dinner", "start_at": "2027-01-05T19:00:00Z"},
            ],
        }
    )
    captured = fake_client(monkeypatch, response=completion(content))
    result = asyncio.run(
        ai.parse_schedule(
            CONFIG,
            text="Make it 3pm instead",
            image=None,
            tz=TZ,
            tz_label="UTC",
            members=MEMBERS,
            history=[
                {"role": "user", "text": "Practice at 9"},
                {"role": "assistant", "text": '{"events":[{"title":"Practice"}]}'},
            ],
        )
    )
    messages = captured["json"]["messages"]
    assert messages[0]["role"] == "system"
    assert messages[1] == {"role": "user", "content": "Practice at 9"}
    assert messages[2]["role"] == "assistant"
    assert '"title":"Practice"' in messages[2]["content"]
    assert messages[3]["role"] == "user"
    assert "Make it 3pm instead" in messages[3]["content"]
    assert result["reply"] == "I found two events. Check the times."
    assert len(result["events"]) == 2


def test_history_is_capped_and_ignores_bad_turns():
    history = [
        {"role": "system", "text": "ignore"},
        {"role": "user", "text": "   "},
        {"role": "user", "text": 5},
        *[
            {"role": "user", "text": f"turn {index}"}
            for index in range(ai.MAX_HISTORY_MESSAGES + 10)
        ],
    ]
    messages = ai._history_messages(history)
    assert len(messages) == ai.MAX_HISTORY_MESSAGES
    assert messages[0]["content"] == "turn 10"
    assert messages[-1]["content"] == "turn 29"
    assert "ignore" not in [message["content"] for message in messages]

    long_turn = ai._history_messages([{"role": "user", "text": "x" * 50_000}])
    assert len(long_turn[0]["content"]) == ai.MAX_HISTORY_CHARS

    assert ai._history_messages(
        [
            None,
            {"role": "system", "text": "ignore"},
            {"role": "user", "text": 5},
            {"role": "user", "text": "   "},
        ]
    ) == []


async def _collect(events):
    return [event async for event in events]


# ── Router integration ─────────────────────────────────────────────────────


class _Scalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _Scalars(self._rows)


class _BusySession:
    def __init__(self, calendar_ids, events):
        self.calendar_ids = calendar_ids
        self.events = events
        self.calls = 0

    async def execute(self, _query):
        self.calls += 1
        if self.calls == 1:
            return _Result(self.calendar_ids)
        return _Result(self.events)


@pytest.mark.asyncio
async def test_load_busy_skips_rows_without_a_start():
    from app.routers import ai as ai_router

    event = SimpleNamespace(
        start_at=datetime(2027, 1, 5, 9, tzinfo=TZ),
        end_at=None,
        all_day=False,
        assignee_id=None,
        recurrence=None,
        title="Existing",
    )
    session = _BusySession(
        ["cal-1"], [SimpleNamespace(start_at=None), event]
    )
    busy = await ai_router._load_busy(session, [])
    assert len(busy) == 1
    assert busy[0]["title"] == "Existing"
    assert busy[0]["end_at"] is None


@pytest.mark.asyncio
async def test_load_busy_without_calendars():
    from app.routers import ai as ai_router

    assert await ai_router._load_busy(_BusySession([], []), []) == []


@pytest.mark.asyncio
async def test_parse_endpoint_returns_conflicts_and_assignee_questions(
    client, monkeypatch
):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    member = (
        await client.post("/api/v1/household/members", json={"name": "Alice Smith"})
    ).json()
    calendar = (
        await client.post(
            "/api/v1/calendars",
            json={"name": "Home", "color": "sage"},
        )
    ).json()
    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=1)
    existing = (
        await client.post(
            "/api/v1/events",
            json={
                "calendar_id": calendar["id"],
                "title": "Dentist",
                "start_at": start.isoformat(),
                "end_at": (start + timedelta(hours=1)).isoformat(),
                "assignee_id": member["id"],
            },
        )
    ).json()
    assert existing["title"] == "Dentist"

    content = json.dumps(
        {
            "events": [
                {
                    "title": "Soccer",
                    "start_at": (start + timedelta(minutes=30)).isoformat(),
                    "end_at": (start + timedelta(hours=2)).isoformat(),
                    "assignee": "Alice",
                    "confidence": 0.9,
                }
            ],
            "questions": [{"question": "Is the year right?"}],
        }
    )
    captured = fake_client(monkeypatch, response=completion(content))
    response = await client.post(
        "/api/v1/ai/parse",
        json={
            "text": "Soccer tomorrow",
            "clarifications": [{"question": "Which day?", "answer": "Tomorrow"}],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["needs_input"] is True
    assert body["questions"][0]["question"] == "Is the year right?"
    assert len(body["conflicts"]) == 1
    assert body["conflicts"][0]["existing_title"] == "Dentist"
    assert body["conflicts"][0]["existing_kind"] == "existing"
    assert body["conflicts"][0]["existing_event_id"] == existing["id"]
    assert body["events"][0]["assignee_id"] == member["id"]
    system = captured["json"]["messages"][0]["content"]
    user = captured["json"]["messages"][1]["content"]
    assert "Alice Smith (Alice)" in system
    assert "Dentist" not in system
    assert "Dentist" in user
    assert "Current calendar" in user
    assert "Q: Which day?" in user


@pytest.mark.asyncio
async def test_parse_endpoint_expands_recurring_busy_events(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    calendar = (
        await client.post(
            "/api/v1/calendars", json={"name": "Home", "color": "sage"}
        )
    ).json()
    start = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=60)
    await client.post(
        "/api/v1/events",
        json={
            "calendar_id": calendar["id"],
            "title": "Weekly swim",
            "start_at": start.isoformat(),
            "end_at": (start + timedelta(hours=1)).isoformat(),
            "recurrence": {"freq": "weekly"},
        },
    )
    # A real occurrence of the series: 60 days ago + 9 weeks = 3 days ahead.
    target = start + timedelta(weeks=9)
    content = json.dumps(
        {
            "events": [
                {
                    "title": "Swim lesson",
                    "start_at": target.isoformat(),
                    "end_at": (target + timedelta(hours=1)).isoformat(),
                }
            ]
        }
    )
    fake_client(monkeypatch, response=completion(content))
    response = await client.post("/api/v1/ai/parse", json={"text": "Swim"})
    assert response.status_code == 200
    assert response.json()["conflicts"][0]["existing_title"] == "Weekly swim"
    assert response.json()["needs_input"] is True

@pytest.mark.asyncio
async def test_conversation_endpoints_round_trip(client):
    payload = {
        "title": "",
        "turns": [
            {"role": "user", "text": "Dentist Friday at 3"},
            {
                "role": "assistant",
                "text": "",
                "reply": "The dentist is booked.",
                "applied": True,
                "outcome": "success",
            },
        ],
    }
    created = await client.post("/api/v1/ai/conversations", json=payload)
    assert created.status_code == 201
    body = created.json()
    conversation_id = body["id"]
    assert body["title"] == "Dentist Friday at 3"
    assert body["turns"][0]["text"] == "Dentist Friday at 3"
    assert body["turns"][1]["reply"] == "The dentist is booked."

    loaded = await client.get(f"/api/v1/ai/conversations/{conversation_id}")
    assert loaded.status_code == 200
    assert loaded.json()["turns"][1]["applied"] is True

    updated = await client.patch(
        f"/api/v1/ai/conversations/{conversation_id}",
        json={**payload, "title": "Updated dentist"},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Updated dentist"

    missing = await client.get(
        "/api/v1/ai/conversations/00000000-0000-0000-0000-000000000123"
    )
    assert missing.status_code == 404
    missing_patch = await client.patch(
        "/api/v1/ai/conversations/00000000-0000-0000-0000-000000000123",
        json=payload,
    )
    assert missing_patch.status_code == 404


@pytest.mark.asyncio
async def test_event_can_link_to_a_conversation(client):
    calendar = (
        await client.post(
            "/api/v1/calendars", json={"name": "Home", "color": "sage"}
        )
    ).json()
    conversation = (
        await client.post(
            "/api/v1/ai/conversations",
            json={
                "title": "Dentist",
                "turns": [{"role": "user", "text": "Dentist Friday"}],
            },
        )
    ).json()
    event = await client.post(
        "/api/v1/events",
        json={
            "calendar_id": calendar["id"],
            "title": "Dentist",
            "start_at": "2027-01-05T09:00:00Z",
            "end_at": "2027-01-05T10:00:00Z",
            "ai_conversation_id": conversation["id"],
        },
    )
    assert event.status_code == 201
    assert event.json()["ai_conversation_id"] == conversation["id"]

    listing = await client.get("/api/v1/events")
    assert listing.json()[0]["ai_conversation_id"] == conversation["id"]

    event_id = event.json()["id"]
    cleared = await client.patch(
        f"/api/v1/events/{event_id}", json={"ai_conversation_id": None}
    )
    assert cleared.status_code == 200
    assert cleared.json()["ai_conversation_id"] is None
    relinked = await client.patch(
        f"/api/v1/events/{event_id}",
        json={"ai_conversation_id": conversation["id"]},
    )
    assert relinked.status_code == 200
    assert relinked.json()["ai_conversation_id"] == conversation["id"]
    bad_link = await client.patch(
        f"/api/v1/events/{event_id}",
        json={"ai_conversation_id": "00000000-0000-0000-0000-000000000123"},
    )
    assert bad_link.status_code == 404

    missing = await client.post(
        "/api/v1/events",
        json={
            "calendar_id": calendar["id"],
            "title": "No thread",
            "start_at": "2027-01-05T09:00:00Z",
            "ai_conversation_id": "00000000-0000-0000-0000-000000000123",
        },
    )
    assert missing.status_code == 404


def test_local_iso_handles_missing_and_naive_values():
    from app.routers import ai as ai_router

    assert ai_router._local_iso(None, TZ) is None
    assert ai_router._local_iso(datetime(2027, 1, 5, 9), TZ) == (
        "2027-01-05T09:00:00+00:00"
    )


@pytest.mark.asyncio
async def test_parse_rejects_unknown_focus_and_allows_external_events(
    client, db_session, monkeypatch
):
    from app.models.all import Event

    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    missing = await client.post(
        "/api/v1/ai/parse",
        json={
            "text": "Move it",
            "focus_event_id": "00000000-0000-0000-0000-000000000123",
        },
    )
    assert missing.status_code == 404

    calendar = (
        await client.post(
            "/api/v1/calendars", json={"name": "Home", "color": "sage"}
        )
    ).json()
    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=1)
    event = (
        await client.post(
            "/api/v1/events",
            json={
                "calendar_id": calendar["id"],
                "title": "External dentist",
                "start_at": start.isoformat(),
                "end_at": (start + timedelta(hours=1)).isoformat(),
            },
        )
    ).json()
    row = await db_session.get(Event, event["id"])
    row.source = "external"
    await db_session.commit()

    content = json.dumps(
        {
            "events": [
                {
                    "title": "External dentist",
                    "start_at": start.isoformat(),
                    "end_at": (start + timedelta(hours=1)).isoformat(),
                }
            ]
        }
    )
    fake_client(monkeypatch, response=completion(content))
    external = await client.post(
        "/api/v1/ai/parse",
        json={"text": "Move it", "focus_event_id": event["id"]},
    )
    assert external.status_code == 200


@pytest.mark.asyncio
async def test_parse_edits_the_focused_event(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    calendar = (
        await client.post(
            "/api/v1/calendars", json={"name": "Home", "color": "sage"}
        )
    ).json()
    event = (
        await client.post(
            "/api/v1/events",
            json={
                "calendar_id": calendar["id"],
                "title": "Dentist",
                "description": "Bring the card",
                "start_at": "2027-01-05T09:00:00Z",
                "end_at": "2027-01-05T10:00:00Z",
            },
        )
    ).json()
    content = json.dumps(
        {
            "events": [
                {
                    "title": "Dentist",
                    "start_at": "2027-01-05T09:00:00Z",
                    "end_at": "2027-01-05T10:00:00Z",
                }
            ]
        }
    )
    captured = fake_client(monkeypatch, response=completion(content))
    response = await client.post(
        "/api/v1/ai/parse",
        json={
            "text": "Change the description only",
            "focus_event_id": event["id"],
        },
    )
    assert response.status_code == 200
    system = captured["json"]["messages"][0]["content"]
    user = captured["json"]["messages"][1]["content"]
    assert "edit of an existing event" in system
    assert "Event being updated" in user
    assert "Dentist" in user
    assert "Return exactly one event" in user
    # The event being edited is not treated as a conflict with itself.
    assert response.json()["conflicts"] == []
    assert response.json()["events"][0]["title"] == "Dentist"


@pytest.mark.asyncio
async def test_parse_returns_validated_updates_and_deletes(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    calendar = (
        await client.post(
            "/api/v1/calendars", json={"name": "Home", "color": "sage"}
        )
    ).json()
    dentist = (
        await client.post(
            "/api/v1/events",
            json={
                "calendar_id": calendar["id"],
                "title": "Dentist",
                "start_at": "2027-01-05T09:00:00Z",
                "end_at": "2027-01-05T10:00:00Z",
            },
        )
    ).json()
    swim = (
        await client.post(
            "/api/v1/events",
            json={
                "calendar_id": calendar["id"],
                "title": "Swim",
                "start_at": "2027-01-06T09:00:00Z",
                "end_at": "2027-01-06T10:00:00Z",
            },
        )
    ).json()

    content = json.dumps(
        {
            "reply": "Moved the dentist and cancelled swim.",
            "document": {"kind": "email"},
            "events": [],
            "updates": [{"ref": 1, "title": "Dentist (moved)", "start_at": "2027-01-05T15:00:00Z"}],
            "deletes": [{"ref": 2, "reason": "Cancelled"}],
            "actions": ["add_another", "done", "bogus", "done"],
        }
    )
    fake_client(monkeypatch, response=completion(content))
    response = await client.post("/api/v1/ai/parse", json={"text": "reschedule"})
    assert response.status_code == 200
    body = response.json()
    assert body["document_kind"] == "email"
    assert body["actions"] == ["add_another", "done"]
    assert body["events"] == []
    assert body["updates"][0]["event_id"] == dentist["id"]
    assert body["updates"][0]["changes"]["title"] == "Dentist (moved)"
    assert body["updates"][0]["changes"]["end_at"] == "2027-01-05T16:00:00+00:00"
    assert body["deletes"][0]["event_id"] == swim["id"]
    assert body["deletes"][0]["reason"] == "Cancelled"


@pytest.mark.asyncio
async def test_patching_an_external_event_is_allowed(client, db_session):
    from app.models.all import Event

    calendar = (
        await client.post(
            "/api/v1/calendars", json={"name": "Home", "color": "sage"}
        )
    ).json()
    event = (
        await client.post(
            "/api/v1/events",
            json={
                "calendar_id": calendar["id"],
                "title": "Synced",
                "start_at": "2027-01-05T09:00:00Z",
                "end_at": "2027-01-05T10:00:00Z",
            },
        )
    ).json()
    row = await db_session.get(Event, event["id"])
    row.source = "external"
    await db_session.commit()

    response = await client.patch(
        f"/api/v1/events/{event['id']}",
        json={"title": "Synced (edited)"},
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Synced (edited)"
