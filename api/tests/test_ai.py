"""Smart import (AI) endpoint and extraction tests.

The outbound HTTP client is faked: tests never touch OpenCode. The fake also
captures the request so the prompt, headers and provider URL can be asserted.
"""

import asyncio
import base64
import io
import json
from datetime import datetime, timezone

import httpx
import pytest
from PIL import Image

from app import ai
from app.config import settings


class FakeResponse:
    def __init__(self, status_code: int = 200, payload=None, json_error: bool = False):
        self.status_code = status_code
        self._payload = payload
        self._json_error = json_error

    def json(self):
        if self._json_error:
            raise ValueError("bad json")
        return self._payload


def fake_client(monkeypatch, *, response=None, exc=None, get_response=None, get_exc=None):
    captured: dict = {}

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, headers=None, json=None):
            captured.update(url=url, headers=headers, json=json)
            if exc is not None:
                raise exc
            return response

        async def get(self, url, headers=None):
            captured.update(url=url, headers=headers, method="GET")
            if get_exc is not None:
                raise get_exc
            return get_response

    monkeypatch.setattr(ai.httpx, "AsyncClient", _Client)
    return captured


def completion(content) -> FakeResponse:
    return FakeResponse(200, {"choices": [{"message": {"content": content}}]})


class FakeStreamResponse:
    def __init__(self, status_code=200, lines=None, exc=None):
        self.status_code = status_code
        self._lines = lines or []
        self._exc = exc

    async def aiter_lines(self):
        if self._exc is not None:
            raise self._exc
        for line in self._lines:
            yield line


class FakeStreamContext:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, *args):
        return False


def fake_stream_client(
    monkeypatch, *, lines=None, status=200, exc=None, stream_exc=None
):
    captured: dict = {}

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url, headers=None, json=None):
            captured.update(method=method, url=url, headers=headers, json=json)
            if stream_exc is not None:
                raise stream_exc
            return FakeStreamContext(FakeStreamResponse(status, lines, exc))

    monkeypatch.setattr(ai.httpx, "AsyncClient", _Client)
    return captured


async def collect_stream(events):
    return [event async for event in events]


def data_url(image: Image.Image, fmt: str = "PNG") -> str:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/{fmt.lower()};base64,{encoded}"


async def configure(client, key: str = "oc_sk_test_secret_1234", provider: str = "console"):
    response = await client.put(
        "/api/v1/ai", json={"api_key": key, "provider": provider}
    )
    assert response.status_code == 200
    return response


# ── Settings / status ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_status_unconfigured(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    response = await client.get("/api/v1/ai")
    assert response.status_code == 200
    assert response.json() == {
        "configured": False,
        "provider": "console",
        "model": settings.opencode_model,
        "key_hint": None,
    }


@pytest.mark.asyncio
async def test_status_uses_environment_key_without_leaking_it(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "oc_sk_env_secret_9876")
    monkeypatch.setattr(settings, "opencode_provider", "go")
    response = await client.get("/api/v1/ai")
    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert body["provider"] == "go"
    assert body["key_hint"] == "…9876"
    assert "oc_sk_env_secret_9876" not in response.text


@pytest.mark.asyncio
async def test_save_key_is_write_only_and_masked(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    response = await configure(client, "oc_sk_very_secret_abcd", "go")
    body = response.json()
    assert body["configured"] is True
    assert body["provider"] == "go"
    assert body["key_hint"] == "…abcd"
    assert "oc_sk_very_secret_abcd" not in response.text

    status = await client.get("/api/v1/ai")
    assert "oc_sk_very_secret_abcd" not in status.text
    assert status.json()["configured"] is True


@pytest.mark.asyncio
async def test_save_without_key_and_without_existing_key_is_rejected(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    response = await client.put("/api/v1/ai", json={"provider": "console"})
    assert response.status_code == 422
    assert "API key" in response.json()["detail"]


@pytest.mark.asyncio
async def test_blank_key_keeps_the_saved_secret_and_updates_provider(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client, "oc_sk_first_secret_1111", "go")
    response = await client.put("/api/v1/ai", json={"provider": "console"})
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "console"
    assert body["key_hint"] == "…1111"


@pytest.mark.asyncio
async def test_short_key_has_no_hint(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    response = await configure(client, "short")
    assert response.json()["key_hint"] is None


@pytest.mark.asyncio
async def test_delete_key_turns_feature_off(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    response = await client.delete("/api/v1/ai")
    assert response.status_code == 204
    status = await client.get("/api/v1/ai")
    assert status.json()["configured"] is False


@pytest.mark.asyncio
async def test_delete_without_saved_key_is_harmless(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    response = await client.delete("/api/v1/ai")
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_corrupt_stored_config_falls_back_to_environment(client, db_session, monkeypatch):
    from app.models.all import ServerSetting

    db_session.add(ServerSetting(key=ai.SETTING_KEY, value="{not json"))
    await db_session.commit()
    monkeypatch.setattr(settings, "opencode_api_key", "oc_sk_env_fallback_2222")
    response = await client.get("/api/v1/ai")
    assert response.json()["configured"] is True
    assert response.json()["key_hint"] == "…2222"


@pytest.mark.asyncio
async def test_stored_non_dict_and_unknown_provider_defaults_to_console(
    client, db_session, monkeypatch
):
    from app.models.all import ServerSetting

    monkeypatch.setattr(settings, "opencode_api_key", "")
    await db_session.merge(ServerSetting(key=ai.SETTING_KEY, value="[]"))
    await db_session.commit()
    assert (await client.get("/api/v1/ai")).json()["configured"] is False

    await db_session.merge(
        ServerSetting(
            key=ai.SETTING_KEY,
            value=json.dumps({"api_key": "oc_sk_x_3333", "provider": "other"}),
        )
    )
    await db_session.commit()
    body = (await client.get("/api/v1/ai")).json()
    assert body["configured"] is True
    assert body["provider"] == "console"


@pytest.mark.asyncio
async def test_provider_validation_on_save(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    response = await client.put(
        "/api/v1/ai", json={"api_key": "oc_sk_test_4444", "provider": "bogus"}
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_saving_over_a_corrupt_config_replaces_it(client, db_session, monkeypatch):
    from app.models.all import ServerSetting

    monkeypatch.setattr(settings, "opencode_api_key", "")
    db_session.add(ServerSetting(key=ai.SETTING_KEY, value="not json"))
    await db_session.commit()
    response = await client.put("/api/v1/ai", json={"api_key": "oc_sk_new_5555"})
    assert response.status_code == 200
    assert response.json()["configured"] is True


@pytest.mark.asyncio
async def test_parse_ignores_a_non_string_household_timezone(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await client.patch("/api/v1/household/settings", json={"settings": {"timezone": 5}})
    await configure(client)
    fake_client(monkeypatch, response=completion('{"events": []}'))
    response = await client.post("/api/v1/ai/parse", json={"text": "x"})
    assert response.status_code == 200


# ── Model list ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_models_requires_configuration(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    response = await client.get("/api/v1/ai/models")
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_models_lists_chat_models_with_image_support(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client, provider="go")
    payload = {
        "object": "list",
        "data": [
            {
                "id": "zeta-vision",
                "name": "Zeta Vision",
                "type": "chat",
                "modalities": {"input": ["text", "image/png"], "output": ["text"]},
            },
            {"id": "alpha", "name": "Alpha"},
            {"id": "image-model", "name": "Image", "type": "image"},
            {"id": "alpha", "name": "Duplicate"},
            "not a model",
            {"id": "", "name": "Empty"},
            {"id": "plain-model"},
            {"id": "weird", "name": "   ", "modalities": {"input": "text"}},
            {"id": 42, "name": "Number"},
        ],
    }
    captured = fake_client(monkeypatch, get_response=FakeResponse(200, payload))
    response = await client.get("/api/v1/ai/models")
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "go"
    assert body["selected"] == settings.opencode_model
    assert body["models"] == [
        {"id": "alpha", "name": "Alpha", "supports_images": False},
        {"id": "plain-model", "name": "plain-model", "supports_images": False},
        {"id": "weird", "name": "weird", "supports_images": False},
        {"id": "zeta-vision", "name": "Zeta Vision", "supports_images": True},
    ]
    assert "/inference/go/v1/models" in captured["url"]


@pytest.mark.asyncio
async def test_models_provider_query_previews_the_selected_plan(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client, provider="go")
    payload = {"data": [{"id": "model", "name": "Model"}]}
    captured = fake_client(monkeypatch, get_response=FakeResponse(200, payload))
    response = await client.get("/api/v1/ai/models?provider=console")
    assert response.status_code == 200
    assert response.json()["provider"] == "console"
    assert "/inference/v1/models" in captured["url"]
    assert "/inference/go/" not in captured["url"]

    invalid = await client.get("/api/v1/ai/models?provider=bogus")
    assert invalid.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response,exc,status",
    [
        (FakeResponse(500, {}), None, 502),
        (FakeResponse(200, {}, json_error=True), None, 502),
        (FakeResponse(200, {"data": "nope"}), None, 502),
        (FakeResponse(200, []), None, 502),
        (None, httpx.TimeoutException("slow"), 504),
        (None, httpx.ConnectError("down"), 502),
    ],
)
async def test_models_failure_modes(client, monkeypatch, response, exc, status):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    fake_client(monkeypatch, get_response=response, get_exc=exc)
    result = await client.get("/api/v1/ai/models")
    assert result.status_code == status


@pytest.mark.asyncio
async def test_saving_a_model_changes_parse_requests(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    response = await client.put("/api/v1/ai", json={"model": "glm-5.3-flash"})
    assert response.status_code == 200
    assert response.json()["model"] == "glm-5.3-flash"
    assert response.json()["provider"] == "console"

    captured = fake_client(monkeypatch, response=completion('{"events": []}'))
    parsed = await client.post("/api/v1/ai/parse", json={"text": "x"})
    assert parsed.status_code == 200
    assert parsed.json()["model"] == "glm-5.3-flash"
    assert captured["json"]["model"] == "glm-5.3-flash"


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["bad model", ""])
async def test_invalid_model_is_rejected(client, monkeypatch, model):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    response = await client.put("/api/v1/ai", json={"model": model})
    assert response.status_code == 422
    assert "valid model" in response.json()["detail"]


@pytest.mark.asyncio
async def test_overlong_model_is_rejected_by_validation(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    response = await client.put("/api/v1/ai", json={"model": "x" * 121})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_blank_key_keeps_the_saved_model(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    await client.put("/api/v1/ai", json={"model": "qwen3.8-flash"})
    response = await client.put("/api/v1/ai", json={"provider": "go"})
    assert response.status_code == 200
    assert response.json()["model"] == "qwen3.8-flash"
    assert response.json()["provider"] == "go"


@pytest.mark.asyncio
async def test_environment_key_can_save_provider_and_model(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "oc_sk_env_secret_4444")
    monkeypatch.setattr(settings, "opencode_provider", "console")
    response = await client.put(
        "/api/v1/ai", json={"provider": "go", "model": "kimi-k3"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert body["provider"] == "go"
    assert body["model"] == "kimi-k3"
    assert "oc_sk_env_secret_4444" not in response.text

    status = await client.get("/api/v1/ai")
    assert status.json()["provider"] == "go"
    assert status.json()["model"] == "kimi-k3"


@pytest.mark.asyncio
async def test_stored_model_wins_over_environment(client, db_session, monkeypatch):
    from app.models.all import ServerSetting

    monkeypatch.setattr(settings, "opencode_api_key", "oc_sk_env_5555")
    monkeypatch.setattr(settings, "opencode_model", "glm-5.3")
    db_session.add(
        ServerSetting(
            key=ai.SETTING_KEY,
            value=json.dumps({"model": "kimi-k3", "provider": "go"}),
        )
    )
    await db_session.commit()
    body = (await client.get("/api/v1/ai")).json()
    assert body["configured"] is True
    assert body["model"] == "kimi-k3"
    assert body["provider"] == "go"


@pytest.mark.asyncio
async def test_invalid_stored_and_environment_models_fall_back(client, db_session, monkeypatch):
    from app.models.all import ServerSetting

    monkeypatch.setattr(settings, "opencode_api_key", "oc_sk_env_6666")
    monkeypatch.setattr(settings, "opencode_model", "bad model")
    db_session.add(
        ServerSetting(key=ai.SETTING_KEY, value=json.dumps({"model": "bad model"}))
    )
    await db_session.commit()
    body = (await client.get("/api/v1/ai")).json()
    assert body["model"] == ai.DEFAULT_MODEL


# ── Test connection ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_connection_requires_a_key(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    response = await client.post("/api/v1/ai/test")
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_connection_ok(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client, provider="go")
    captured = fake_client(monkeypatch, get_response=FakeResponse(200, {"data": []}))
    response = await client.post("/api/v1/ai/test")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["message"] == "Connected"
    assert "/inference/go/v1/models" in captured["url"]
    assert captured["headers"]["Authorization"].startswith("Bearer oc_sk_")


@pytest.mark.asyncio
async def test_connection_rejected_key(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    fake_client(monkeypatch, get_response=FakeResponse(401, {}))
    response = await client.post("/api/v1/ai/test")
    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert "401" in response.json()["message"]


@pytest.mark.asyncio
async def test_connection_timeout(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    fake_client(monkeypatch, get_exc=httpx.TimeoutException("slow"))
    response = await client.post("/api/v1/ai/test")
    assert response.status_code == 504


@pytest.mark.asyncio
async def test_connection_transport_error(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    fake_client(monkeypatch, get_exc=httpx.ConnectError("nope"))
    response = await client.post("/api/v1/ai/test")
    assert response.status_code == 502


# ── Parsing ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_parse_requires_configuration(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    response = await client.post("/api/v1/ai/parse", json={"text": "Dinner Friday"})
    assert response.status_code == 503


@pytest.mark.asyncio
async def test_parse_requires_text_or_image(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    response = await client.post("/api/v1/ai/parse", json={"text": "   "})
    assert response.status_code == 422
    assert "Paste an email" in response.json()["detail"]


@pytest.mark.asyncio
async def test_parse_text_returns_validated_drafts(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await client.patch(
        "/api/v1/household/settings",
        json={"settings": {"timezone": "America/Toronto"}},
    )
    member = (
        await client.post("/api/v1/household/members", json={"name": "Alice"})
    ).json()
    await configure(client)

    content = json.dumps(
        {
            "events": [
                {
                    "title": "  Team standup  ",
                    "description": "Zoom link",
                    "start_at": "2026-05-04T09:30:00",
                    "end_at": "2026-05-04T10:00:00",
                    "all_day": False,
                    "recurrence": {
                        "freq": "weekly",
                        "until": "2026-06-01T00:00:00",
                        "count": 5,
                    },
                    "recurrence_reason": "every Monday",
                    "reminder_minutes": "10",
                    "assignee": "alice",
                    "confidence": 2,
                },
                {
                    "title": "Holiday",
                    "start_at": "2026-05-06T00:00:00",
                    "end_at": None,
                    "all_day": True,
                    "confidence": "0.4",
                },
                {"title": "No date"},
            ]
        }
    )
    captured = fake_client(monkeypatch, response=completion(content))
    response = await client.post(
        "/api/v1/ai/parse",
        json={"text": "Standup every Monday at 9:30 for 30 minutes. Remind me 10 min before."},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["skipped"] == 1
    assert body["model"] == settings.opencode_model
    first, second = body["events"]
    assert first["title"] == "Team standup"
    assert first["start_at"].endswith("-04:00")
    assert first["recurrence"]["freq"] == "weekly"
    assert first["recurrence"]["count"] == 5
    assert first["reminder_minutes"] == 10
    assert first["assignee_id"] == member["id"]
    assert first["confidence"] == 1.0
    assert second["all_day"] is True
    assert second["end_at"] is None
    assert second["confidence"] == 0.4

    assert captured["url"].endswith("/inference/openai/v1/chat/completions")
    assert captured["json"]["model"] == settings.opencode_model
    assert captured["json"]["response_format"] == {"type": "json_object"}
    assert captured["json"]["messages"][1]["content"].startswith("Standup every Monday")
    assert "Alice" in captured["json"]["messages"][0]["content"]
    assert captured["headers"]["User-Agent"].startswith("homst/")


@pytest.mark.asyncio
async def test_parse_accepts_history_and_returns_reply(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    content = json.dumps({"reply": "Done — two events are ready.", "events": []})
    captured = fake_client(monkeypatch, response=completion(content))
    response = await client.post(
        "/api/v1/ai/parse",
        json={
            "text": "Make them an hour later",
            "history": [
                {"role": "user", "text": "Standup at 9"},
                {"role": "assistant", "text": '{"events":[{"title":"Standup"}]}'},
            ],
        },
    )
    assert response.status_code == 200
    assert response.json()["reply"] == "Done — two events are ready."
    messages = captured["json"]["messages"]
    assert messages[0]["role"] == "system"
    assert messages[1] == {"role": "user", "content": "Standup at 9"}
    assert messages[2]["role"] == "assistant"
    assert "Standup" in messages[2]["content"]
    assert messages[3]["role"] == "user"
    assert "Make them an hour later" in messages[3]["content"]


@pytest.mark.asyncio
async def test_parse_go_provider_and_list_content(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client, provider="go")
    payload = {
        "events": [
            {
                "title": "Coffee",
                "start_at": "2026-05-04T08:00:00Z",
                "end_at": "2026-05-04T07:00:00Z",
            }
        ]
    }
    captured = fake_client(
        monkeypatch,
        response=FakeResponse(
            200,
            {
                "choices": [
                    {"message": {"content": [{"type": "text", "text": json.dumps(payload)}]}}
                ]
            },
        ),
    )
    response = await client.post("/api/v1/ai/parse", json={"text": "Coffee Monday"})
    assert response.status_code == 200
    event = response.json()["events"][0]
    # An inverted end is repaired to start + 1 hour.
    assert event["end_at"] == "2026-05-04T09:00:00Z"
    assert "/inference/go/openai/v1/chat/completions" in captured["url"]


@pytest.mark.asyncio
async def test_parse_fenced_json_and_unknown_timezone(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    content = "```json\n" + json.dumps(
        {"events": [{"title": "Market", "start_at": "2026-05-04T09:00:00"}]}
    ) + "\n```"
    fake_client(monkeypatch, response=completion(content))
    response = await client.post(
        "/api/v1/ai/parse",
        json={"text": "Market", "timezone": "Mars/Olympus_Mons"},
    )
    assert response.status_code == 200
    assert response.json()["events"][0]["start_at"].endswith("Z")


@pytest.mark.asyncio
async def test_parse_image_only_is_forwarded(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    captured = fake_client(
        monkeypatch,
        response=completion(
            json.dumps(
                {"events": [{"title": "Dinner", "start_at": "2026-05-04T18:00:00Z"}]}
            )
        ),
    )
    image = Image.new("RGB", (800, 600), "white")
    response = await client.post(
        "/api/v1/ai/parse", json={"text": "", "image": data_url(image)}
    )
    assert response.status_code == 200
    user = captured["json"]["messages"][1]["content"]
    assert user[0]["text"].startswith("Extract the schedule from this image.")
    assert user[1]["image_url"]["url"].startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_parse_rejects_bad_image_payloads(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)

    bad_url = await client.post(
        "/api/v1/ai/parse", json={"text": "x", "image": "not-a-data-url"}
    )
    assert bad_url.status_code == 415

    bad_base64 = await client.post(
        "/api/v1/ai/parse", json={"text": "x", "image": "data:image/png;base64,!!!!"}
    )
    assert bad_base64.status_code == 415

    not_image = base64.b64encode(b"hello").decode()
    corrupt = await client.post(
        "/api/v1/ai/parse",
        json={"text": "x", "image": f"data:image/png;base64,{not_image}"},
    )
    assert corrupt.status_code == 415

    tiff = data_url(Image.new("RGB", (10, 10)), "TIFF")
    unsupported = await client.post(
        "/api/v1/ai/parse", json={"text": "x", "image": tiff}
    )
    assert unsupported.status_code == 415


@pytest.mark.asyncio
async def test_parse_rejects_oversized_image(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    monkeypatch.setattr(ai, "MAX_IMAGE_BYTES", 10)
    await configure(client)
    response = await client.post(
        "/api/v1/ai/parse",
        json={"text": "x", "image": data_url(Image.new("RGB", (20, 20)))},
    )
    assert response.status_code == 415
    assert "too large" in response.json()["detail"]


@pytest.mark.asyncio
async def test_parse_downscales_and_strips_metadata(client):
    image = Image.new("RGB", (4000, 2000), "red")
    normalized = ai._normalize_image(data_url(image))
    raw = base64.b64decode(normalized.split(",", 1)[1])
    with Image.open(io.BytesIO(raw)) as decoded:
        assert decoded.width == ai.MAX_IMAGE_EDGE
        assert decoded.height == ai.MAX_IMAGE_EDGE // 2


@pytest.mark.asyncio
async def test_parse_normalizes_palette_images(client):
    normalized = ai._normalize_image(data_url(Image.new("P", (10, 10))))
    assert normalized.startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_parse_empty_events_list(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    fake_client(monkeypatch, response=completion('{"events": []}'))
    response = await client.post("/api/v1/ai/parse", json={"text": "Newsletter"})
    assert response.status_code == 200
    assert response.json()["events"] == []


@pytest.mark.asyncio
async def test_parse_upstream_http_error(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    fake_client(monkeypatch, response=FakeResponse(500, {}))
    response = await client.post("/api/v1/ai/parse", json={"text": "x"})
    assert response.status_code == 502
    assert "500" in response.json()["detail"]


@pytest.mark.asyncio
async def test_parse_upstream_timeout(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    fake_client(monkeypatch, exc=httpx.TimeoutException("slow"))
    response = await client.post("/api/v1/ai/parse", json={"text": "x"})
    assert response.status_code == 504


@pytest.mark.asyncio
async def test_parse_upstream_transport_error(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    fake_client(monkeypatch, exc=httpx.ConnectError("down"))
    response = await client.post("/api/v1/ai/parse", json={"text": "x"})
    assert response.status_code == 502


@pytest.mark.asyncio
async def test_parse_invalid_upstream_json(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    fake_client(monkeypatch, response=FakeResponse(200, {}, json_error=True))
    response = await client.post("/api/v1/ai/parse", json={"text": "x"})
    assert response.status_code == 502
    assert "invalid response" in response.json()["detail"]


@pytest.mark.asyncio
async def test_parse_non_object_upstream_json(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    fake_client(monkeypatch, response=FakeResponse(200, []))
    response = await client.post("/api/v1/ai/parse", json={"text": "x"})
    assert response.status_code == 502


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"choices": []},
        {"choices": [{"message": {"content": ""}}]},
        {"choices": [{"message": {"content": None}}]},
        {"choices": [{"message": "nope"}]},
        {"choices": "nope"},
    ],
)
async def test_parse_unusable_answers(client, monkeypatch, payload):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    fake_client(monkeypatch, response=FakeResponse(200, payload))
    response = await client.post("/api/v1/ai/parse", json={"text": "x"})
    assert response.status_code == 502


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content",
    [
        "not json",
        "[]",
        '{"events": "nope"}',
    ],
)
async def test_parse_malformed_model_json(client, monkeypatch, content):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    fake_client(monkeypatch, response=completion(content))
    response = await client.post("/api/v1/ai/parse", json={"text": "x"})
    assert response.status_code == 502


@pytest.mark.asyncio
async def test_parse_skips_invalid_events_and_caps_the_list(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    monkeypatch.setattr(ai, "MAX_EVENTS", 3)
    await configure(client)
    fake_client(
        monkeypatch,
        response=completion(
            json.dumps(
                {
                    "events": [
                        "not a dict",
                        {"title": "", "start_at": "2026-05-04T09:00:00Z"},
                        {"title": "Good", "start_at": "2026-05-04T09:00:00Z"},
                        {"title": "Too many", "start_at": "2026-05-05T09:00:00Z"},
                    ]
                }
            )
        ),
    )
    response = await client.post("/api/v1/ai/parse", json={"text": "x"})
    assert response.status_code == 200
    assert [e["title"] for e in response.json()["events"]] == ["Good"]


@pytest.mark.asyncio
async def test_parse_returns_raw_response_and_reasoning(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    payload = {
        "choices": [
            {
                "message": {
                    "content": '{"events": []}',
                    "reasoning_content": "Read the email first.",
                }
            }
        ]
    }
    fake_client(monkeypatch, response=FakeResponse(200, payload))
    response = await client.post("/api/v1/ai/parse", json={"text": "x"})
    assert response.status_code == 200
    body = response.json()
    assert body["response"] == '{"events": []}'
    assert body["reasoning"] == "Read the email first."


@pytest.mark.asyncio
async def test_parse_accepts_reasoning_content_parts(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    payload = {
        "choices": [
            {
                "message": {
                    "content": [{"type": "text", "text": '{"events": []}'}],
                    "reasoning": [{"type": "text", "text": "Part one "}, {"text": "part two"}],
                }
            }
        ]
    }
    fake_client(monkeypatch, response=FakeResponse(200, payload))
    response = await client.post("/api/v1/ai/parse", json={"text": "x"})
    assert response.status_code == 200
    assert response.json()["reasoning"] == "Part one part two"


@pytest.mark.asyncio
async def test_stream_schedule_relays_deltas_and_result(monkeypatch):
    config = {"api_key": "k", "provider": "console", "model": ai.DEFAULT_MODEL}
    lines = [
        "",
        "event: ping",
        "data: 5",
        'data: {"choices": []}',
        'data: {"choices": "no"}',
        'data: {"choices": [5]}',
        'data: {"choices": [{"delta": "no"}]}',
        'data: {"choices":[{"delta":{"reasoning_content":"Read "}}]}',
        'data: {"choices":[{"delta":{"reasoning":"the email"}}]}',
        'data: {"choices":[{"delta":{"content":"{\\"events\\": ["}}]}',
        "data: not-json",
        'data: {"choices":[{"delta":{"content":"]}"}}]}',
        "data: [DONE]",
        'data: {"choices":[{"delta":{"content":"ignored"}}]}',
    ]
    captured = fake_stream_client(monkeypatch, lines=lines)
    tz, label = ai.resolve_timezone("UTC")
    events = await collect_stream(
        ai.stream_schedule(
            config, text="x", image=None, tz=tz, tz_label=label, members=[]
        )
    )
    assert [event["type"] for event in events] == [
        "reasoning",
        "reasoning",
        "content",
        "content",
        "result",
    ]
    assert events[0]["text"] == "Read "
    assert events[1]["text"] == "the email"
    result = events[-1]
    assert result["events"] == []
    assert result["response"] == '{"events": []}'
    assert result["reasoning"] == "Read the email"
    assert result["model"] == ai.DEFAULT_MODEL
    assert captured["json"]["stream"] is True
    assert captured["method"] == "POST"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kwargs,error",
    [
        ({"status": 500}, ai.AiUpstreamError),
        ({"exc": httpx.TimeoutException("slow")}, ai.AiTimeoutError),
        ({"exc": httpx.ConnectError("down")}, ai.AiUpstreamError),
        ({"stream_exc": httpx.TimeoutException("slow")}, ai.AiTimeoutError),
        ({"stream_exc": httpx.ConnectError("down")}, ai.AiUpstreamError),
    ],
)
async def test_stream_schedule_failure_modes(monkeypatch, kwargs, error):
    config = {"api_key": "k", "provider": "console", "model": ai.DEFAULT_MODEL}
    fake_stream_client(monkeypatch, **kwargs)
    tz, label = ai.resolve_timezone("UTC")
    with pytest.raises(error):
        await collect_stream(
            ai.stream_schedule(
                config, text="x", image=None, tz=tz, tz_label=label, members=[]
            )
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("content", ["", "not json", '{"events": "nope"}'])
async def test_stream_schedule_rejects_bad_final_content(monkeypatch, content):
    config = {"api_key": "k", "provider": "console", "model": ai.DEFAULT_MODEL}
    lines = [
        f'data: {{"choices":[{{"delta":{{"content":{json.dumps(content)}}}}}]}}',
        "data: [DONE]",
    ]
    fake_stream_client(monkeypatch, lines=lines)
    tz, label = ai.resolve_timezone("UTC")
    with pytest.raises(ai.AiUpstreamError):
        await collect_stream(
            ai.stream_schedule(
                config, text="x", image=None, tz=tz, tz_label=label, members=[]
            )
        )


@pytest.mark.asyncio
async def test_stream_schedule_requires_input(monkeypatch):
    config = {"api_key": "k", "provider": "console", "model": ai.DEFAULT_MODEL}
    fake_stream_client(monkeypatch)
    tz, label = ai.resolve_timezone("UTC")
    with pytest.raises(ai.AiInputError):
        await collect_stream(
            ai.stream_schedule(
                config, text=" ", image=None, tz=tz, tz_label=label, members=[]
            )
        )


@pytest.mark.asyncio
async def test_stream_endpoint_relays_sse_events(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    lines = [
        'data: {"choices":[{"delta":{"reasoning_content":"Thinking"}}]}',
        'data: {"choices":[{"delta":{"content":"{\\"events\\": []}"}}]}',
        "data: [DONE]",
    ]
    fake_stream_client(monkeypatch, lines=lines)
    async with client.stream(
        "POST", "/api/v1/ai/parse/stream", json={"text": "x"}
    ) as response:
        assert response.status_code == 200
        raw = "".join([part async for part in response.aiter_text()])
    assert "event: reasoning" in raw
    assert "Thinking" in raw
    assert "event: content" in raw
    assert "event: result" in raw
    assert '"response": "{\\"events\\": []}"' in raw


@pytest.mark.asyncio
async def test_stream_endpoint_sends_an_error_event(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    await configure(client)
    fake_stream_client(monkeypatch, status=500)
    async with client.stream(
        "POST", "/api/v1/ai/parse/stream", json={"text": "x"}
    ) as response:
        assert response.status_code == 200
        raw = "".join([part async for part in response.aiter_text()])
    assert "event: error" in raw
    assert "OpenCode returned HTTP 500" in raw


@pytest.mark.asyncio
async def test_stream_endpoint_requires_config_and_input(client, monkeypatch):
    monkeypatch.setattr(settings, "opencode_api_key", "")
    assert (
        await client.post("/api/v1/ai/parse/stream", json={"text": "x"})
    ).status_code == 503
    await configure(client)
    assert (
        await client.post("/api/v1/ai/parse/stream", json={"text": " "})
    ).status_code == 422


# ── Validation helpers ─────────────────────────────────────────────────────


def test_coerce_helpers_cover_edge_values():
    tz = timezone.utc
    assert ai._coerce_datetime(datetime(2026, 1, 1, tzinfo=tz), tz) is not None
    assert ai._coerce_datetime("", tz) is None
    assert ai._coerce_datetime("nonsense", tz) is None
    assert ai._coerce_datetime(123, tz) is None

    assert ai._coerce_int(True) is None
    assert ai._coerce_int(4) == 4
    assert ai._coerce_int("7") == 7
    assert ai._coerce_int("x") is None
    assert ai._coerce_int(1.5) is None

    assert ai._coerce_confidence("x") == 0.0
    assert ai._coerce_confidence(-1) == 0.0
    assert ai._coerce_confidence(5) == 1.0

    assert ai._resolve_assignee(None, []) is None
    assert ai._resolve_assignee("  ", []) is None
    assert ai._resolve_assignee("Bob", [("1", "Alice")]) is None


def test_recurrence_validation():
    start = datetime(2026, 5, 4, 9, tzinfo=timezone.utc)
    assert ai._coerce_recurrence("weekly", start, timezone.utc) is None
    assert ai._coerce_recurrence({"freq": "hourly"}, start, timezone.utc) is None
    rule = ai._coerce_recurrence(
        {"freq": "monthly", "until": "2026-04-01T00:00:00Z", "count": 0},
        start,
        timezone.utc,
    )
    assert rule == {"freq": "monthly"}
    assert ai._coerce_recurrence(
        {"freq": "daily", "count": 1000}, start, timezone.utc
    ) == {"freq": "daily"}


def test_validate_event_edges():
    tz = timezone.utc
    assert ai._validate_event("x", tz, [])[0] is None
    assert ai._validate_event({"title": None, "start_at": "2026-01-01"}, tz, [])[0] is None
    assert ai._validate_event({"title": "x", "start_at": "bad"}, tz, [])[0] is None

    event, stripped, issues = ai._validate_event(
        {
            "title": "All day",
            "start_at": "2026-01-01T00:00:00Z",
            "end_at": "2026-01-01T00:00:00Z",
            "all_day": True,
            "description": 42,
            "reminder_minutes": 99_999,
        },
        tz,
        [],
    )
    assert stripped is False
    assert issues == []
    assert event["end_at"] is None
    assert event["description"] == ""
    assert event["reminder_minutes"] is None

    event, _, _ = ai._validate_event(
        {"title": "T", "start_at": "2026-01-01T09:00:00Z", "reminder_minutes": 30},
        tz,
        [],
    )
    assert event["end_at"] == "2026-01-01T10:00:00+00:00"
    assert event["reminder_minutes"] == 30


def test_unjustified_recurrence_is_stripped():
    tz = timezone.utc
    base = {
        "title": "Pizza",
        "start_at": "2027-01-05T00:00:00Z",
        "all_day": True,
        "recurrence": {"freq": "weekly", "until": "2027-03-31T00:00:00Z"},
    }
    event, stripped, issues = ai._validate_event(base, tz, [])
    assert stripped is True
    assert event["recurrence"] is None
    assert issues == []

    kept, stripped, _ = ai._validate_event(
        {**base, "recurrence_reason": "every Tuesday"}, tz, []
    )
    assert stripped is False
    assert kept["recurrence"]["freq"] == "weekly"

    drafts, skipped, warnings = ai.validate_payload({"events": [base]}, tz, [])
    assert skipped == 0
    assert len(drafts) == 1
    assert warnings == [
        "Repeat rules were ignored: the message didn't state one."
    ]


def test_validation_checks_weekdays_duplicates_completeness_and_uncertainty():
    tz = timezone.utc
    event = {
        "title": "Pizza",
        "start_at": "2027-01-05T00:00:00Z",
        "source_weekday": "Monday",
        "confidence": 0.95,
    }
    draft, _, issues = ai._validate_event(event, tz, [])
    assert issues and "does not match Tuesday" in issues[0]
    assert draft["confidence"] == 0.4

    payload = {
        "document": {"dated_rows": 30},
        "events": [event, event, "not an event"],
        "uncertain": ["Jan 21 may be unreadable", 42],
    }
    drafts, skipped, warnings = ai.validate_payload(payload, tz, [])
    assert len(drafts) == 1
    assert skipped == 2
    assert "Skipped 1 duplicate row." in warnings
    assert (
        "1 date doesn't match the weekday printed in the message. Check that event."
        in warnings
    )
    assert (
        "The message may list 30 dated items, but only 3 were found. "
        "Check for missing events." in warnings
    )
    assert "Check the source: Jan 21 may be unreadable" in warnings


def test_validation_warns_about_multiple_weekday_mismatches():
    tz = timezone.utc
    payload = {
        "events": [
            {
                "title": "Pizza",
                "start_at": "2027-01-05T00:00:00Z",
                "source_weekday": "Monday",
            },
            {
                "title": "Pasta",
                "start_at": "2027-01-06T00:00:00Z",
                "source_weekday": "Monday",
            },
        ],
    }
    drafts, skipped, warnings = ai.validate_payload(payload, tz, [])
    assert len(drafts) == 2
    assert skipped == 0
    assert (
        "2 dates don't match the weekday printed in the message. Check those events."
        in warnings
    )


def test_resolve_timezone_falls_back():
    tz, label = ai.resolve_timezone(None)
    assert label == "UTC"
    tz, label = ai.resolve_timezone("Not/AZone")
    assert label == "UTC"
    tz, label = ai.resolve_timezone("America/Toronto")
    assert label == "America/Toronto"


def test_parse_schedule_accepts_naive_now(monkeypatch):
    captured = fake_client(
        monkeypatch,
        response=completion('{"events": []}'),
    )
    config = {"api_key": "k", "provider": "console", "model": ai.DEFAULT_MODEL}
    tz, label = ai.resolve_timezone("UTC")
    result = asyncio.run(
        ai.parse_schedule(
            config,
            text="x",
            image=None,
            tz=tz,
            tz_label=label,
            members=[],
            now=datetime(2026, 5, 4, 9, 0),
        )
    )
    assert result["events"] == []
    assert "(Monday)" in captured["json"]["messages"][0]["content"]
    assert "Members: none" in captured["json"]["messages"][0]["content"]
