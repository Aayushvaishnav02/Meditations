from __future__ import annotations

from app.config import AISettings


def test_default_config_is_masked(client):
    r = client.get("/api/settings/ai")
    body = r.json()
    assert body["provider"] == "openai_compatible"
    assert body["model_name"] == "llama3.2:3b"
    assert body["base_url"] == "http://localhost:11434/v1"
    assert body["api_key_set"] is True  # default "ollama"
    assert "api_key" not in body


def test_put_override_persists_and_masks_secret(client):
    r = client.put("/api/settings/ai", json={"model_name": "gpt-4o-mini", "api_key": "sk-test-123"})
    assert r.status_code == 200

    body = client.get("/api/settings/ai").json()
    assert body["model_name"] == "gpt-4o-mini"
    assert body["api_key_set"] is True
    assert "sk-test-123" not in r.text  # secret never leaves the server


def test_delete_resets_to_env_defaults(client):
    client.put("/api/settings/ai", json={"model_name": "gpt-4o-mini", "base_url": "https://openrouter.ai/api/v1"})
    body = client.delete("/api/settings/ai").json()
    assert body["model_name"] == "llama3.2:3b"
    assert body["base_url"] == "http://localhost:11434/v1"


def test_empty_string_clears_override(client):
    client.put("/api/settings/ai", json={"base_url": "https://openrouter.ai/api/v1"})
    body = client.put("/api/settings/ai", json={"base_url": ""}).json()
    assert body["base_url"] == "http://localhost:11434/v1"  # fell back to env default


def test_partial_update_only_touches_sent_fields(client):
    client.put("/api/settings/ai", json={"provider": "anthropic"})
    body = client.get("/api/settings/ai").json()
    assert body["provider"] == "anthropic"
    assert body["model_name"] == "llama3.2:3b"  # untouched


def test_factory_builds_correct_model_per_provider():
    from pydantic_ai.models.anthropic import AnthropicModel
    from pydantic_ai.models.openai import OpenAIChatModel

    from app.ai_factory import create_agent_model

    openai_compatible = create_agent_model(
        AISettings(ai_provider="openai_compatible", ai_model_name="llama3.2:3b")
    )
    assert isinstance(openai_compatible.wrapped, OpenAIChatModel)
    assert type(openai_compatible.wrapped).__name__ == "OpenAIChatModel"

    anthropic = create_agent_model(
        AISettings(ai_provider="anthropic", ai_model_name="claude-3-5-haiku-latest", ai_api_key="k")
    )
    assert isinstance(anthropic.wrapped, AnthropicModel)
