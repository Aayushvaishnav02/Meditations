"""Tests for the new AI surface: RAG ask, editor assist, streaming endpoints,
prompt overrides, fast-model routing and usage telemetry."""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager

import pytest
from pydantic_ai import ModelHTTPError
from pydantic_ai.messages import ModelResponse
from pydantic_ai.models import Model, ModelRequestParameters

import app.agents as agents
from app.ai_factory import PROMPT_KEYS, create_agent_model
from app.config import AISettings
from app.models import DailyScore


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.strip().split("\n\n"):
        lines = block.splitlines()
        ev = next(l[7:] for l in lines if l.startswith("event: "))
        data = json.loads(next(l[6:] for l in lines if l.startswith("data: ")))
        events.append((ev, data))
    return events


def make_entry(client, day: str, text: str) -> None:
    assert client.put(f"/api/journal/{day}", json={"raw_markdown": text}).status_code == 200


# --- prompt registry sync ---
def test_prompt_keys_in_sync():
    assert set(PROMPT_KEYS) == set(agents.PROMPT_DEFAULTS)
    assert all(agents.PROMPT_DEFAULTS.values())


# --- fast model tier ---
def test_fast_tier_uses_fast_model(monkeypatch):
    settings = AISettings(ai_model_name="main-model", ai_fast_model_name="fast-model", ai_api_key="k", ai_base_url="http://x/v1")
    assert create_agent_model(settings, resilient=False).model_name == "main-model"
    assert create_agent_model(settings, resilient=False, fast=True).model_name == "fast-model"


def test_fast_tier_falls_back_to_main():
    settings = AISettings(ai_model_name="main-model", ai_fast_model_name=None, ai_api_key="k", ai_base_url="http://x/v1")
    assert create_agent_model(settings, resilient=False, fast=True).model_name == "main-model"


# --- prompt overrides through the settings API ---
def test_prompts_roundtrip(client):
    body = client.get("/api/settings/ai/prompts").json()
    keys = [p["key"] for p in body["prompts"]]
    assert "daily" in keys and "assist_improve" in keys
    assert all(p["override"] is None for p in body["prompts"])
    assert all(p["default"] for p in body["prompts"])

    r = client.put("/api/settings/ai/prompts", json={"overrides": {"daily": "Be terse.", "ask": ""}})
    assert r.status_code == 200
    by_key = {p["key"]: p for p in r.json()["prompts"]}
    assert by_key["daily"]["override"] == "Be terse."
    assert by_key["ask"]["override"] is None  # empty string clears

    # unknown key → 422
    assert client.put("/api/settings/ai/prompts", json={"overrides": {"nope": "x"}}).status_code == 422


def test_daily_rollup_uses_prompt_override(client, monkeypatch):
    captured = {}

    async def fake(deps, model=None, system_prompt=None, on_usage=None):
        captured["system_prompt"] = system_prompt
        if on_usage:
            await on_usage(agents.UsageReport(agent="daily", model="stub", input_tokens=10, output_tokens=5, duration_ms=12))
        return agents.DailyReviewOutput()

    monkeypatch.setattr(agents, "run_daily_review", fake)
    make_entry(client, "2026-09-10", "text")
    assert client.post("/api/agents/rollup/daily?day=2026-09-10").status_code == 200
    assert captured["system_prompt"] is None  # no override yet

    client.put("/api/settings/ai/prompts", json={"overrides": {"daily": "Custom daily prompt."}})
    assert client.post("/api/agents/rollup/daily?day=2026-09-10").status_code == 200
    assert captured["system_prompt"] == "Custom daily prompt."

    # the usage rows written by the stub's on_usage callback (one per rollup)
    rows = client.get("/api/settings/ai/usage?days=1").json()
    assert rows["calls"] == 2 and rows["by_agent"][0]["agent"] == "daily"


# --- streaming: ask ---
def test_ask_stream_cites_sources(client, monkeypatch):
    make_entry(client, "2026-09-10", "Felt burned out on the backend refactor after the migration.")

    async def fake(deps, model=None, system_prompt=None, on_usage=None):
        assert "[1]" in deps.context and "burned out" in deps.context
        assert deps.question == "why the burnout?"
        texts = ["You hit", "You hit the wall [1]"]
        for t in texts:
            yield t

    monkeypatch.setattr(agents, "stream_ask", fake)

    r = client.post("/api/agents/ask/stream", json={"question": "why the burnout?", "history": []})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(r.text)
    kinds = [e for e, _ in events]
    assert kinds[0] == "sources"
    assert kinds.count("partial") == 2
    assert kinds[-1] == "done"
    _, done = events[-1]
    assert done["text"].endswith("[1]")
    assert done["sources"][0]["kind"] == "journal"
    assert done["sources"][0]["n"] == 1


def test_ask_stream_without_entries(client, monkeypatch):
    async def fake(deps, model=None, system_prompt=None, on_usage=None):
        assert deps.context == ""  # nothing matched
        yield "I have no entries about that."

    monkeypatch.setattr(agents, "stream_ask", fake)
    r = client.post("/api/agents/ask/stream", json={"question": "what did I dream about?"})
    events = parse_sse(r.text)
    assert events[0] == ("sources", [])
    assert events[-1][0] == "done"


def test_ask_stream_surfaces_llm_errors(client, monkeypatch):
    async def fake(deps, model=None, system_prompt=None, on_usage=None):
        raise ModelHTTPError(503, "m", body={"message": "RESOURCE_EXHAUSTED (reset after 15m)"})
        yield  # pragma: no cover

    monkeypatch.setattr(agents, "stream_ask", fake)
    r = client.post("/api/agents/ask/stream", json={"question": "q"})
    events = parse_sse(r.text)
    assert events[-1][0] == "error"
    assert "rate limit" in events[-1][1]["message"].lower()


# --- streaming: daily rollup persists the final output ---
def test_daily_stream_persists_final(client, monkeypatch):
    make_entry(client, "2026-09-10", "Productive day.")
    partials = [
        agents.DailyReviewOutput(llm_nudge=0, feedback="half"),
        agents.DailyReviewOutput(llm_nudge=4.0, feedback="full feedback", key_insight="insight"),
    ]

    async def fake(deps, model=None, system_prompt=None, on_usage=None):
        for p in partials:
            yield p

    monkeypatch.setattr(agents, "stream_daily_review", fake)
    r = client.post("/api/agents/rollup/daily/stream?day=2026-09-10")
    events = parse_sse(r.text)
    kinds = [e for e, _ in events]
    assert kinds == ["partial", "partial", "done"]
    _, done = events[-1]
    assert done["llm_nudge"] == 4.0 and done["persisted"] is True

    stored = client.get("/api/scores/daily/2026-09-10").json()
    assert stored["persisted"] is True and stored["final_score"] == pytest.approx(stored["weighted_score"] + 4.0)


def test_daily_stream_requires_entry(client):
    r = client.post("/api/agents/rollup/daily/stream?day=2030-01-01")
    assert r.status_code == 404


# --- streaming: briefing ---
def test_briefing_stream(client, monkeypatch):
    async def fake(deps, model=None, system_prompt=None, on_usage=None):
        yield agents.BriefingOutput(top_focus=["A", "B", "C"], reasoning="r")

    monkeypatch.setattr(agents, "stream_briefing", fake)
    r = client.post("/api/agents/briefing/stream")
    events = parse_sse(r.text)
    assert events[-1][0] == "done"
    assert events[-1][1]["top_focus"] == ["A", "B", "C"]


# --- streaming: editor assist ---
def test_assist_stream(client, monkeypatch):
    async def fake(deps, model=None, system_prompt=None, on_usage=None):
        assert deps.action == "improve" and "draft text" in deps.text
        yield "Improved text."

    monkeypatch.setattr(agents, "stream_assist", fake)
    r = client.post("/api/agents/assist/stream", json={"action": "improve", "text": "draft text"})
    events = parse_sse(r.text)
    assert events[-1] == ("done", {"text": "Improved text."})


def test_assist_stream_unknown_action(client):
    r = client.post("/api/agents/assist/stream", json={"action": "vibecode", "text": "x"})
    events = parse_sse(r.text)
    assert events[-1][0] == "error"
    assert "unknown assist action" in events[-1][1]["message"]


# --- usage telemetry endpoint ---
def test_usage_endpoint_aggregates(client, monkeypatch):
    async def fake(deps, model=None, system_prompt=None, on_usage=None):
        if on_usage:
            await on_usage(agents.UsageReport(agent="ask", model="stub", input_tokens=10, output_tokens=200, duration_ms=30))
        yield "answer"

    monkeypatch.setattr(agents, "stream_ask", fake)
    assert client.post("/api/agents/ask/stream", json={"question": "q"}).status_code == 200

    body = client.get("/api/settings/ai/usage?days=7").json()
    assert body["calls"] == 1
    assert body["input_tokens"] == 10 and body["output_tokens"] == 200
    assert body["by_agent"][0]["agent"] == "ask"


# --- streaming retry in ResilientModel ---
class FlakyStreamModel(Model):
    model_name = "flaky"
    system = "test"

    def __init__(self, failures: int):
        self.failures = failures
        self.calls = 0

    async def request(self, messages, model_settings, model_request_parameters) -> ModelResponse:
        raise AssertionError("not used")

    @asynccontextmanager
    async def request_stream(self, messages, model_settings, model_request_parameters, run_context=None):
        self.calls += 1
        if self.calls <= self.failures:
            raise ModelHTTPError(503, self.model_name, body=None)
        yield "stream"


def test_resilient_stream_retries_before_first_yield(monkeypatch):
    import app.ai_factory as af

    monkeypatch.setattr(af, "RETRY_BACKOFF_SECONDS", (0.0, 0.0))
    model = af.ResilientModel(FlakyStreamModel(failures=1))

    async def consume():
        chunks = []
        async with model.request_stream([], None, ModelRequestParameters()) as stream:
            chunks.append(stream)
        return chunks

    assert asyncio.run(consume()) == ["stream"]
    assert model.wrapped.calls == 2


def test_resilient_stream_does_not_retry_after_yield(monkeypatch):
    import asyncio

    import app.ai_factory as af

    monkeypatch.setattr(af, "RETRY_BACKOFF_SECONDS", (0.0, 0.0))

    class DiesMidStream(FlakyStreamModel):
        @asynccontextmanager
        async def request_stream(self, messages, model_settings, model_request_parameters, run_context=None):
            self.calls += 1
            yield "chunk"  # consumer sees this…
            raise ModelHTTPError(503, self.model_name, body=None)  # …then the stream dies

    model = af.ResilientModel(DiesMidStream(failures=99))

    async def consume():
        seen = []
        async with model.request_stream([], None, ModelRequestParameters()) as stream:
            seen.append(stream)
        return seen

    with pytest.raises(ModelHTTPError):
        asyncio.run(consume())
    assert model.wrapped.calls == 1  # no silent stream restart
