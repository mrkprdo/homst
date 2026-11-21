"""OpenCode-powered schedule extraction.

The household pastes an email (or a screenshot) into the quick-add panel and
the model turns it into calendar-event drafts. This module owns the outbound
request, the prompt and the validation of the model's JSON, so routers stay
thin and the API key never leaves the server.

Two fixed gateways are supported on purpose: a pasted key can only ever be
sent to OpenCode, never to an arbitrary host.
"""

from __future__ import annotations

import base64
import io
import json
import re
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.all import ServerSetting
from app.version import VERSION

SETTING_KEY = "ai_config"

# Provider id → the two OpenCode endpoints we use. ``chat`` is the
# OpenAI-compatible completion API; ``models`` is a cheap endpoint for the
# "Test connection" button (it validates the key without spending tokens).
PROVIDERS: dict[str, dict[str, str]] = {
    "console": {
        "chat": "https://opencode.ai/inference/openai/v1/chat/completions",
        "models": "https://opencode.ai/inference/v1/models",
    },
    "go": {
        "chat": "https://opencode.ai/inference/go/openai/v1/chat/completions",
        "models": "https://opencode.ai/inference/go/v1/models",
    },
}

MAX_TEXT_CHARS = 100_000
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGE_EDGE = 2048
MAX_EVENTS = 60
MAX_TITLE_CHARS = 255
MAX_DESCRIPTION_CHARS = 20_000
MAX_REMINDER_MINUTES = 10_080
MAX_RAW_CHARS = 20_000

RECURRENCE_FREQS = {"daily", "weekly", "biweekly", "monthly", "yearly"}

_DATA_URL_RE = re.compile(r"^data:(image/[\w.+-]+);base64,(.+)$", re.IGNORECASE | re.DOTALL)
_FENCED_JSON_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.IGNORECASE | re.DOTALL)
_MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$")
DEFAULT_MODEL = "deepseek-v4.1-flash"


class AiError(Exception):
    """Base class for errors the router translates into HTTP responses."""

    status_code = 502


class AiInputError(AiError):
    status_code = 422


class AiImageError(AiInputError):
    status_code = 415

    def __init__(self, detail: str = "Unsupported or corrupt image") -> None:
        super().__init__(detail)


class AiUpstreamError(AiError):
    status_code = 502


class AiTimeoutError(AiError):
    status_code = 504

    def __init__(self) -> None:
        super().__init__("OpenCode took too long to answer")


# ── Stored configuration ───────────────────────────────────────────────────


def _valid_provider(value: Any) -> str:
    return value if isinstance(value, str) and value in PROVIDERS else "console"


def _default_model() -> str:
    """The configured default, falling back to DeepSeek if the env value is bad."""
    model = settings.opencode_model.strip()
    return model if _MODEL_RE.match(model) else DEFAULT_MODEL


def _env_config() -> dict:
    """Defaults supplied through the environment (appliance installs)."""
    config: dict = {
        "provider": _valid_provider(settings.opencode_provider),
        "model": _default_model(),
    }
    key = settings.opencode_api_key.strip()
    if key:
        config["api_key"] = key
    return config


def _stored_config(row) -> dict:
    """Read only the fields we trust from the stored JSON blob."""
    if row is None or not row.value:
        return {}
    try:
        data = json.loads(row.value)
    except (TypeError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict = {}
    key = data.get("api_key")
    if isinstance(key, str) and key.strip():
        out["api_key"] = key.strip()
    provider = data.get("provider")
    if isinstance(provider, str) and provider in PROVIDERS:
        out["provider"] = provider
    model = data.get("model")
    if isinstance(model, str) and _MODEL_RE.match(model.strip()):
        out["model"] = model.strip()
    return out


async def load_config(db: AsyncSession) -> dict | None:
    """Return ``{api_key, provider, model}`` or ``None`` when Smart import is off.

    Stored values win; the environment fills any gaps.
    """
    stored = _stored_config(await db.get(ServerSetting, SETTING_KEY))
    env = _env_config()
    key = stored.get("api_key") or env.get("api_key")
    if not key:
        return None
    return {
        "api_key": key,
        "provider": stored.get("provider") or env["provider"],
        "model": stored.get("model") or env["model"],
    }


async def save_config(
    db: AsyncSession,
    api_key: str | None,
    provider: str | None,
    model: str | None = None,
) -> dict:
    """Store the key, provider and model. ``None`` keeps an existing value."""
    existing = await db.get(ServerSetting, SETTING_KEY)
    stored = _stored_config(existing)

    chosen_provider = stored.get("provider") or _valid_provider(settings.opencode_provider)
    if provider is not None:
        chosen_provider = _valid_provider(provider)

    key = api_key.strip() if isinstance(api_key, str) else ""
    if not key:
        key = stored.get("api_key", "")

    if model is not None:
        chosen_model = model.strip()
        if not chosen_model or not _MODEL_RE.match(chosen_model):
            raise AiInputError("Choose a valid model")
    else:
        chosen_model = stored.get("model") or _default_model()

    env_key = settings.opencode_api_key.strip()
    if not key and not env_key:
        raise AiInputError("An API key is required")

    merged = {**stored}
    if key:
        merged["api_key"] = key
    merged["provider"] = chosen_provider
    if model is not None:
        merged["model"] = chosen_model

    payload = json.dumps(merged)
    if existing:
        existing.value = payload
    else:
        db.add(ServerSetting(key=SETTING_KEY, value=payload))
    await db.commit()
    return {
        "api_key": key or env_key,
        "provider": chosen_provider,
        "model": chosen_model,
    }


async def clear_config(db: AsyncSession) -> None:
    """Forget the UI key. An environment key still applies afterwards."""
    row = await db.get(ServerSetting, SETTING_KEY)
    if row:
        await db.delete(row)
        await db.commit()


def _hint(api_key: str) -> str | None:
    """A redacted tail that lets the household recognise the saved key."""
    key = (api_key or "").strip()
    if len(key) < 8:
        return None
    return f"…{key[-4:]}"


def status_payload(config: dict | None) -> dict:
    """Public status. Never includes the key itself."""
    provider = (
        config["provider"] if config else _valid_provider(settings.opencode_provider)
    )
    return {
        "configured": config is not None,
        "provider": provider,
        "model": config["model"] if config else _default_model(),
        "key_hint": _hint(config["api_key"]) if config else None,
    }


def _headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": f"homst/{VERSION}",
        # Go requires a stable session id; it also helps prompt caching.
        "x-opencode-session": "homst-smart-import",
    }


# ── Outbound requests ──────────────────────────────────────────────────────


async def test_connection(config: dict) -> tuple[bool, str]:
    """Validate a key against the cheap models endpoint."""
    provider = _valid_provider(config["provider"])
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                PROVIDERS[provider]["models"], headers=_headers(config["api_key"])
            )
    except httpx.TimeoutException as exc:
        raise AiTimeoutError() from exc
    except httpx.HTTPError as exc:
        raise AiUpstreamError("Could not reach OpenCode") from exc
    if response.status_code >= 400:
        return False, f"OpenCode rejected the key (HTTP {response.status_code})"
    return True, "Connected"


def _model_entry(raw: Any) -> dict | None:
    """Normalise one item from the provider's OpenAI-shaped model list."""
    if not isinstance(raw, dict):
        return None
    model_id = raw.get("id")
    if not isinstance(model_id, str) or not model_id.strip():
        return None
    model_id = model_id.strip()
    model_type = raw.get("type")
    if isinstance(model_type, str) and model_type != "chat":
        return None
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip():
        name = model_id
    supports_images = False
    modalities = raw.get("modalities")
    if isinstance(modalities, dict):
        inputs = modalities.get("input")
        if isinstance(inputs, list):
            supports_images = any(
                isinstance(item, str) and (item == "image" or item.startswith("image/"))
                for item in inputs
            )
    return {"id": model_id, "name": name.strip(), "supports_images": supports_images}


async def list_models(config: dict) -> dict:
    """Fetch the model catalog for the configured gateway and key."""
    provider = _valid_provider(config["provider"])
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                PROVIDERS[provider]["models"], headers=_headers(config["api_key"])
            )
    except httpx.TimeoutException as exc:
        raise AiTimeoutError() from exc
    except httpx.HTTPError as exc:
        raise AiUpstreamError("Could not reach OpenCode") from exc

    if response.status_code >= 400:
        raise AiUpstreamError(f"OpenCode returned HTTP {response.status_code}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise AiUpstreamError("OpenCode returned an invalid response") from exc
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        raise AiUpstreamError("OpenCode returned no models list")

    models: list[dict] = []
    seen: set[str] = set()
    for raw in data:
        entry = _model_entry(raw)
        if entry is None or entry["id"] in seen:
            continue
        seen.add(entry["id"])
        models.append(entry)
    models.sort(key=lambda item: (item["name"].casefold(), item["id"]))
    return {"models": models, "provider": provider, "selected": config["model"]}


def _text_parts(value: Any) -> str:
    """Join the text of a plain string or an OpenAI-style content-part list."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(
            part.get("text", "")
            for part in value
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        )
    return ""


REASONING_KEYS = ("reasoning_content", "reasoning", "reasoning_text")


def _reasoning_of(container: dict) -> str:
    for key in REASONING_KEYS:
        text = _text_parts(container.get(key))
        if text:
            return text
    return ""


def _extract_message(payload: dict) -> tuple[str, str]:
    """Return ``(answer, reasoning)`` from a non-streaming completion."""
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise AiUpstreamError("OpenCode returned no choices")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        raise AiUpstreamError("OpenCode returned an empty answer")
    content = _text_parts(message.get("content"))
    if not content:
        raise AiUpstreamError("OpenCode returned an empty answer")
    return content, _reasoning_of(message)


def _extract_delta(chunk: Any) -> tuple[str, str]:
    """Return ``(content_delta, reasoning_delta)`` from a streaming chunk."""
    if not isinstance(chunk, dict):
        return "", ""
    choices = chunk.get("choices")
    if not isinstance(choices, list) or not choices:
        return "", ""
    delta = choices[0].get("delta") if isinstance(choices[0], dict) else None
    if not isinstance(delta, dict):
        return "", ""
    return _text_parts(delta.get("content")), _reasoning_of(delta)


def _parse_json_answer(answer: str) -> dict:
    text = answer.strip()
    fenced = _FENCED_JSON_RE.match(text)
    if fenced:
        text = fenced.group(1).strip()
    try:
        payload = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise AiUpstreamError("OpenCode did not return valid JSON") from exc
    if not isinstance(payload, dict):
        raise AiUpstreamError("OpenCode did not return a JSON object")
    return payload


# ── Prompt ─────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """You are HOMST's document-understanding assistant. You extract
calendar events from schedule images and pasted messages with evidence-backed accuracy.

Work in this order:
1. Read the document as a whole: title, month/year, table headers, legends and
   colour keys, notes and summary totals.
2. Build the legend map, but NEVER create events from legend entries. A legend
   only expands an item that appears on a dated row or marked calendar cell.
3. Transcribe every dated row or marked cell using spatial position, not colour
   alone. Record the date, the weekday printed on that row, and the item.
4. Validate before answering: date parses, weekday matches, month/year is
   consistent, no duplicate rows. Never shift a date by a day.
5. Only then emit events.

Return ONLY this JSON object:
{"document": {
   "kind": "table | calendar_grid | email | poster | other",
   "dated_rows": 0,
   "notes": ""
 },
 "events": [{
   "title": "short event title",
   "description": "optional notes, address, links or confirmation numbers",
   "start_at": "ISO 8601 date-time with an offset",
   "end_at": "ISO 8601 date-time with an offset, or null",
   "all_day": false,
   "recurrence": null,
   "recurrence_reason": "exact words that say it repeats, or null",
   "reminder_minutes": null,
   "assignee": "member name or null",
   "source_weekday": "weekday printed on the source row, or null",
   "evidence": "the dated row this came from, e.g. Jan 5 / Tuesday / Pizza",
   "confidence": 0.95,
   "issues": []
 }],
 "uncertain": []
}

The household is in __TZ__. Use this offset for every date-time.
Now: __NOW__ (__WEEKDAY__).
Members: __MEMBERS__.

Rules:
- ONE event per dated row or marked day. A 30-row table means 30 events. Never
  merge rows with the same meal, category or colour into one event.
- A table, calendar grid, or list of dated rows is NOT a recurrence. Set
  recurrence to null on every row and ignore category and summary totals.
- Never create one event per category or legend entry. The title comes from the
  dated row, not from a key such as "Purple = Pizza".
- Never infer unlisted dates and never fill gaps by repeating. Do not convert a
  date list into a weekly, daily or monthly series.
- recurrence is null or {"freq": "daily" | "weekly" | "biweekly" |
  "monthly" | "yearly", "until": ISO 8601 or null, "count": integer or null}.
  Use recurrence only when the source literally states a repeat rule ("every
  Tuesday", "weekly", "each month") and quote those words in recurrence_reason.
  If you cannot quote a repeat rule, recurrence MUST be null.
- If no year is given, choose the next occurrence on or after today.
- Date-only items are all-day: all_day true, start_at at 00:00 local time,
  end_at null. If a timed event has no end, end_at is one hour after start_at.
- reminder_minutes is the number of minutes before start_at, only when the
  message explicitly asks for a reminder; otherwise null.
- Use source_weekday for every dated row. If the printed weekday does not match
  the date, keep the printed date, add a note to issues, and lower confidence.
  Never silently correct a date.
- If a date or item is unreadable, omit that row and list it in uncertain.
  Never guess or fabricate. Prefer an incomplete answer over a wrong one.
- Never invent dates, times, people or details. Skip undated items, greetings,
  marketing, unsubscribe text and unrelated content.
- Return {"document": {...}, "events": [], "uncertain": []} when nothing is scheduled.
__IMAGE_RULES__"""

_IMAGE_RULES = """
- This request includes a screenshot. Read it row by row at full resolution.
  If it is a table or calendar, transcribe every dated row exactly: copy the
  date, the weekday printed on the row and the item. Cross-check the legend
  against the item text, but do not turn the legend or summary into events.
  Ignore colours except as a hint for reading the item."""


def _system_prompt(
    now: datetime, tz_label: str, members: list[str], has_image: bool
) -> str:
    member_line = ", ".join(members) if members else "none"
    return (
        _SYSTEM_PROMPT.replace("__TZ__", tz_label)
        .replace("__NOW__", now.isoformat())
        .replace("__WEEKDAY__", now.strftime("%A"))
        .replace("__MEMBERS__", member_line)
        .replace("__IMAGE_RULES__", _IMAGE_RULES if has_image else "")
    )


def _user_content(text: str, image_data_url: str | None) -> str | list[dict]:
    prompt = text.strip() or "Extract the schedule from this image."
    if not image_data_url:
        return prompt
    return [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": image_data_url}},
    ]


# ── Input handling ─────────────────────────────────────────────────────────


def _normalize_image(data_url: str) -> str:
    """Validate, orient and shrink an image; return a PNG data URL.

    Re-encoding strips metadata (EXIF/GPS) before anything leaves the house,
    and the edge cap keeps token usage predictable.
    """
    match = _DATA_URL_RE.match(data_url.strip())
    if not match:
        raise AiImageError()
    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except (ValueError, TypeError) as exc:
        raise AiImageError() from exc
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise AiImageError("Image is too large")
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            fmt = (image.format or "").upper()
            if fmt not in {"JPEG", "PNG", "WEBP", "GIF", "BMP"}:
                raise AiImageError()
            image = ImageOps.exif_transpose(image) or image
            if image.width > MAX_IMAGE_EDGE or image.height > MAX_IMAGE_EDGE:
                scale = MAX_IMAGE_EDGE / max(image.width, image.height)
                image = image.resize(
                    (round(image.width * scale), round(image.height * scale)),
                    Image.LANCZOS,
                )
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA")
            out = io.BytesIO()
            image.save(out, format="PNG", optimize=True)
            encoded = base64.b64encode(out.getvalue()).decode("ascii")
    except AiImageError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise AiImageError() from exc
    return f"data:image/png;base64,{encoded}"


def resolve_timezone(name: str | None) -> tuple[Any, str]:
    """Return ``(tzinfo, label)``, falling back to UTC for unknown names."""
    candidate = (name or "").strip() or "UTC"
    try:
        zone = ZoneInfo(candidate)
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc, "UTC"
    return zone, candidate


def _coerce_datetime(value: Any, tz: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz)
    return parsed


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def _coerce_recurrence(value: Any, start: datetime, tz: Any) -> dict | None:
    if not isinstance(value, dict):
        return None
    freq = value.get("freq")
    if freq not in RECURRENCE_FREQS:
        return None
    rule: dict = {"freq": freq}
    until = _coerce_datetime(value.get("until"), tz)
    if until is not None and until > start:
        rule["until"] = until.isoformat()
    count = _coerce_int(value.get("count"))
    if count is not None and 1 <= count <= 730:
        rule["count"] = count
    return rule


def _coerce_confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, confidence))


def _resolve_assignee(value: Any, members: list[tuple[str, str]]) -> str | None:
    if not isinstance(value, str):
        return None
    wanted = value.strip().casefold()
    if not wanted:
        return None
    for member_id, name in members:
        if name.strip().casefold() == wanted:
            return member_id
    return None


def _validate_event(
    raw: Any, tz: Any, members: list[tuple[str, str]]
) -> tuple[dict | None, bool, list[str]]:
    """Return ``(draft, recurrence_was_stripped, issues)`` for one model event."""
    if not isinstance(raw, dict):
        return None, False, []
    title = raw.get("title")
    if not isinstance(title, str) or not title.strip():
        return None, False, []
    start = _coerce_datetime(raw.get("start_at"), tz)
    if start is None:
        return None, False, []

    all_day = raw.get("all_day") is True
    end = _coerce_datetime(raw.get("end_at"), tz)
    if all_day:
        end = end if end is not None and end > start else None
    elif end is None or end <= start:
        end = start.replace(microsecond=0) + timedelta(hours=1)

    description = raw.get("description")
    if not isinstance(description, str):
        description = ""

    reminder = _coerce_int(raw.get("reminder_minutes"))
    if reminder is not None and not (0 <= reminder <= MAX_REMINDER_MINUTES):
        reminder = None

    issues: list[str] = []
    source_weekday = raw.get("source_weekday")
    if isinstance(source_weekday, str) and source_weekday.strip():
        expected = start.strftime("%A")
        if source_weekday.strip().casefold()[:3] != expected.casefold()[:3]:
            issues.append(
                f"Printed weekday '{source_weekday.strip()}' does not match "
                f"{expected} on {start.date().isoformat()}."
            )

    recurrence = _coerce_recurrence(raw.get("recurrence"), start, tz)
    stripped = False
    if recurrence is not None:
        reason = raw.get("recurrence_reason")
        if not isinstance(reason, str) or len(reason.strip()) < 3:
            # A repeat rule without a quoted source phrase is almost always the
            # model turning a date table into a series. Never let that through.
            recurrence = None
            stripped = True

    confidence = _coerce_confidence(raw.get("confidence"))
    if issues:
        confidence = min(confidence, 0.4)

    return {
        "title": title.strip()[:MAX_TITLE_CHARS],
        "description": description.strip()[:MAX_DESCRIPTION_CHARS],
        "start_at": start.isoformat(),
        "end_at": end.isoformat() if end is not None else None,
        "all_day": all_day,
        "recurrence": recurrence,
        "reminder_minutes": reminder,
        "assignee_id": _resolve_assignee(raw.get("assignee"), members),
        "confidence": confidence,
    }, stripped, issues


def validate_payload(
    payload: dict, tz: Any, members: list[tuple[str, str]]
) -> tuple[list[dict], int, list[str]]:
    """Turn the model's answer into safe drafts. Invalid entries are skipped."""
    events = payload.get("events")
    if not isinstance(events, list):
        raise AiUpstreamError("OpenCode returned no events list")
    drafts: list[dict] = []
    seen: set[tuple[str, str]] = set()
    stripped = 0
    duplicates = 0
    issue_count = 0
    for raw in events[:MAX_EVENTS]:
        draft, was_stripped, issues = _validate_event(raw, tz, members)
        if draft is None:
            continue
        key = (draft["title"].casefold(), draft["start_at"])
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        drafts.append(draft)
        stripped += int(was_stripped)
        issue_count += len(issues)

    warnings: list[str] = []
    if stripped:
        warnings.append(
            "Repeat rules were ignored: the message didn't state one."
        )
    if duplicates:
        row = "row" if duplicates == 1 else "rows"
        warnings.append(f"Skipped {duplicates} duplicate {row}.")
    if issue_count:
        if issue_count == 1:
            warnings.append(
                "1 date doesn't match the weekday printed in the message. "
                "Check that event."
            )
        else:
            warnings.append(
                f"{issue_count} dates don't match the weekday printed in the "
                "message. Check those events."
            )

    document = payload.get("document")
    if isinstance(document, dict):
        declared_rows = _coerce_int(document.get("dated_rows"))
        # A one- or two-row miscount is common (headers/totals); only flag a
        # material gap such as a 30-row table collapsed into 5 categories.
        if declared_rows is not None and declared_rows - len(events) >= 3:
            found = len(events)
            verb = "was" if found == 1 else "were"
            warnings.append(
                f"The message may list {declared_rows} dated items, but only "
                f"{found} {verb} found. Check for missing events."
            )

    uncertain = payload.get("uncertain")
    if isinstance(uncertain, list):
        for item in uncertain[:3]:
            if isinstance(item, str) and item.strip():
                warnings.append(f"Check the source: {item.strip()}")

    return drafts, max(0, len(events) - len(drafts)), warnings


# ── Public entry points ────────────────────────────────────────────────────


def _prepare_schedule(
    config: dict,
    *,
    text: str,
    image: str | None,
    tz: Any,
    tz_label: str,
    members: list[tuple[str, str]],
    now: datetime | None,
    stream: bool,
) -> tuple[str, dict[str, str], dict]:
    """Validate input and build the OpenCode request."""
    if not text.strip() and not image:
        raise AiInputError("Paste an email or attach a screenshot")

    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    local_now = moment.astimezone(tz)

    image_data_url = _normalize_image(image) if image else None
    body = {
        "model": config["model"],
        "temperature": 0,
        "stream": stream,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": _system_prompt(
                    local_now,
                    tz_label,
                    [name for _, name in members],
                    has_image=image_data_url is not None,
                ),
            },
            {"role": "user", "content": _user_content(text, image_data_url)},
        ],
    }
    provider = _valid_provider(config["provider"])
    return (
        PROVIDERS[provider]["chat"],
        _headers(config["api_key"]),
        body,
    )


def _result_payload(
    config: dict,
    answer: str,
    reasoning: str,
    tz: Any,
    members: list[tuple[str, str]],
) -> dict:
    drafts, skipped, warnings = validate_payload(
        _parse_json_answer(answer), tz, members
    )
    return {
        "events": drafts,
        "skipped": skipped,
        "model": config["model"],
        "response": answer[:MAX_RAW_CHARS],
        "reasoning": reasoning[:MAX_RAW_CHARS] or None,
        "warnings": warnings,
    }


async def parse_schedule(
    config: dict,
    *,
    text: str,
    image: str | None,
    tz: Any,
    tz_label: str,
    members: list[tuple[str, str]],
    now: datetime | None = None,
) -> dict:
    """Ask the model for event drafts. Nothing is written to the database."""
    url, headers, body = _prepare_schedule(
        config,
        text=text,
        image=image,
        tz=tz,
        tz_label=tz_label,
        members=members,
        now=now,
        stream=False,
    )
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(url, headers=headers, json=body)
    except httpx.TimeoutException as exc:
        raise AiTimeoutError() from exc
    except httpx.HTTPError as exc:
        raise AiUpstreamError("Could not reach OpenCode") from exc

    if response.status_code >= 400:
        raise AiUpstreamError(f"OpenCode returned HTTP {response.status_code}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise AiUpstreamError("OpenCode returned an invalid response") from exc
    if not isinstance(payload, dict):
        raise AiUpstreamError("OpenCode returned an invalid response")

    answer, reasoning = _extract_message(payload)
    return _result_payload(config, answer, reasoning, tz, members)


async def stream_schedule(
    config: dict,
    *,
    text: str,
    image: str | None,
    tz: Any,
    tz_label: str,
    members: list[tuple[str, str]],
    now: datetime | None = None,
) -> AsyncIterator[dict]:
    """Stream reasoning/content deltas, then one final ``result`` event.

    Nothing is written to the database. The caller relays each dict as an SSE
    event; failures become an ``error`` event with the HTTP status to show.
    """
    url, headers, body = _prepare_schedule(
        config,
        text=text,
        image=image,
        tz=tz,
        tz_label=tz_label,
        members=members,
        now=now,
        stream=True,
    )
    content: list[str] = []
    reasoning: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            async with client.stream("POST", url, headers=headers, json=body) as response:
                if response.status_code >= 400:
                    raise AiUpstreamError(
                        f"OpenCode returned HTTP {response.status_code}"
                    )
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                    except ValueError:
                        continue
                    delta, thought = _extract_delta(chunk)
                    if thought:
                        reasoning.append(thought)
                        yield {"type": "reasoning", "text": thought}
                    if delta:
                        content.append(delta)
                        yield {"type": "content", "text": delta}
    except httpx.TimeoutException as exc:
        raise AiTimeoutError() from exc
    except httpx.HTTPError as exc:
        raise AiUpstreamError("Could not reach OpenCode") from exc

    yield {
        "type": "result",
        **_result_payload(
            config, "".join(content), "".join(reasoning), tz, members
        ),
    }
