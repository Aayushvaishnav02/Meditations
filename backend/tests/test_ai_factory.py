"""Tests for ai_factory: retry-on-429/5xx wrapper and error translation."""

from __future__ import annotations

import datetime as dt

import httpx
import pytest
from pydantic_ai import ModelHTTPError
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart
from pydantic_ai.models import Model
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RequestUsage

import app.ai_factory as ai_factory


class FlakyModel(Model):
    """Raises transient ModelHTTPError N times, then returns a fixed response."""

    model_name = "flaky"
    system = "test"

    def __init__(self, failures: int, status_code: int = 503, body: object = None):
        self.failures = failures
        self.status_code = status_code
        self.body = body
        self.calls = 0

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        self.calls += 1
        if self.calls <= self.failures:
            raise ModelHTTPError(self.status_code, self.model_name, body=self.body)
        return ModelResponse(parts=[TextPart("ok")], model_name=self.model_name, timestamp=dt.datetime.now(dt.UTC), usage=RequestUsage(input_tokens=1, output_tokens=1))


@pytest.fixture()
def no_wait(monkeypatch):
    monkeypatch.setattr(ai_factory, "RETRY_BACKOFF_SECONDS", (0.0, 0.0, 0.0))


def test_resilient_model_retries_transient_and_recovers(no_wait):
    model = ai_factory.ResilientModel(FlakyModel(failures=2))
    response = _run(model)
    assert response.parts[0].content == "ok"
    assert model.calls == 3


def test_resilient_model_gives_up_after_backoff_budget(no_wait):
    model = ai_factory.ResilientModel(FlakyModel(failures=99))
    with pytest.raises(ModelHTTPError):
        _run(model)
    assert model.calls == 1 + len(ai_factory.RETRY_BACKOFF_SECONDS)


def test_resilient_model_does_not_retry_client_errors(no_wait):
    model = ai_factory.ResilientModel(FlakyModel(failures=99, status_code=401))
    with pytest.raises(ModelHTTPError):
        _run(model)
    assert model.calls == 1  # auth failures are permanent — fail fast


def _run(model: Model) -> ModelResponse:
    import asyncio

    return asyncio.run(model.request([], None, ModelRequestParameters()))


# --- describe_ai_error ---
@pytest.mark.parametrize(
    ("exc", "needle"),
    [
        (ModelHTTPError(503, "m", body={"message": "[antigravity/x] [429]: RESOURCE_EXHAUSTED (reset after 15m)"}), "rate limit"),
        (ModelHTTPError(429, "m", body=None), "rate limit"),
        (ModelHTTPError(401, "m", body={"message": "Invalid API key"}), "api key"),
        (ModelHTTPError(404, "m", body=None), "not found"),
        (httpx.ConnectError("connection refused"), "running"),
    ],
)
def test_describe_ai_error_translations(exc, needle):
    msg = ai_factory.describe_ai_error(exc)
    assert needle in msg.lower()


def test_describe_ai_error_fallback():
    assert ai_factory.describe_ai_error(ValueError("boom")) == "boom"


# --- factory wiring ---
def test_create_agent_model_wraps_resilient():
    model = ai_factory.create_agent_model()
    assert isinstance(model, ai_factory.ResilientModel)
    assert model.wrapped.model_name  # identity forwarded through the wrapper


def test_create_agent_model_raw():
    model = ai_factory.create_agent_model(resilient=False)
    assert not isinstance(model, ai_factory.ResilientModel)


def test_resilient_model_retries_connection_errors(no_wait):
    from pydantic_ai import ModelAPIError

    class ConnectFailThenOk(Model):
        model_name = "flaky"
        system = "test"

        def __init__(self):
            self.calls = 0

        async def request(self, messages, model_settings, model_request_parameters):
            self.calls += 1
            if self.calls <= 1:
                raise ModelAPIError(model_name=self.model_name, message="Connection error.")
            return ModelResponse(parts=[TextPart("ok")], model_name=self.model_name, timestamp=dt.datetime.now(dt.UTC), usage=RequestUsage(input_tokens=1, output_tokens=1))

    model = ai_factory.ResilientModel(ConnectFailThenOk())
    assert _run(model).parts[0].content == "ok"
    assert model.wrapped.calls == 2


def test_describe_ai_error_connection():
    from pydantic_ai import ModelAPIError

    assert "running" in ai_factory.describe_ai_error(ModelAPIError(model_name="m", message="Connection error."))


def test_quota_error_retries_after_reset_hint_once(no_wait, monkeypatch):
    """Quota errors wait out the gateway's reset hint, once, then surface."""
    sleeps = []
    monkeypatch.setattr(ai_factory.asyncio, "sleep", lambda s: sleeps.append(s) or _noop())
    model = ai_factory.ResilientModel(
        FlakyModel(failures=99, body={"message": "[ag/x] [429]: quota (reset after 4m 21s)"})
    )
    with pytest.raises(ModelHTTPError):
        _run(model)
    assert sleeps == [5.0 + 261.0 if 261.0 + 5.0 <= ai_factory.RESET_RETRY_CAP_SECONDS else ai_factory.RESET_RETRY_CAP_SECONDS]
    assert model.wrapped.calls == 2  # exactly one timed retry, then honest failure


def test_transient_5xx_walks_backoff_ladder(no_wait):
    sleeps = []
    model = ai_factory.ResilientModel(FlakyModel(failures=99))
    with pytest.raises(ModelHTTPError):
        _run(model)
    assert model.wrapped.calls == 1 + len(ai_factory.RETRY_BACKOFF_SECONDS)


async def _noop():
    return None


def test_reset_hint_parsing():
    assert ai_factory._reset_hint_seconds(Exception("reset after 15m")) == 900.0
    assert ai_factory._reset_hint_seconds(Exception("reset after 4m 21s")) == 261.0
    assert ai_factory._reset_hint_seconds(Exception("reset after 1h 2m 3s")) == 3723.0
    assert ai_factory._reset_hint_seconds(Exception("no hint")) is None
