"""Builds pydantic-ai model instances from env + DB settings (plan §3.2/§7.1).

pydantic-ai v2 API note: OpenAIModel was renamed OpenAIChatModel and both
model classes now take a provider object carrying base_url/api_key; agents
use output_type= (formerly result_type=).

Personal gateways (Antigravity, Ollama proxies, OpenRouter free tiers) rate
limit aggressively and often mask upstream 429s as 503s, so the factory wraps
every model in ResilientModel: a few spaced retries on transient HTTP errors,
plus describe_ai_error() for human-readable failure messages.
"""

from __future__ import annotations

import asyncio
import re
from contextlib import asynccontextmanager

from pydantic_ai import ModelAPIError, ModelHTTPError
from pydantic_ai.models import Model
from pydantic_ai.models.wrapper import WrapperModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import AISettings, get_ai_settings
from app.models import AppSetting
from app.util import utc_now

OVERRIDABLE_KEYS = ("ai_provider", "ai_model_name", "ai_fast_model_name", "ai_base_url", "ai_api_key")

# Agent keys whose system prompts can be overridden via app_settings ("prompt_<key>").
# Kept in sync with agents.PROMPT_DEFAULTS (asserted in tests).
PROMPT_KEYS = (
    "daily",
    "weekly",
    "monthly",
    "decompose",
    "capture",
    "briefing",
    "ask",
    "assist_improve",
    "assist_continue",
    "assist_summarize",
)

# Space the retries wide enough to survive per-minute rate-limit windows
# without hanging a UI request for the full ~15-min quota reset.
RETRY_BACKOFF_SECONDS = (3.0, 9.0, 27.0)
# Quota errors carry "reset after 4m 21s" hints: wait exactly that long (once),
# but never stall a UI request longer than this cap — past it, fail with the
# translated message so the user can retry when the window actually resets.
RESET_RETRY_CAP_SECONDS = 120.0


def _reset_hint_seconds(exc: Exception) -> float | None:
    """Parse a 'reset after 4m 21s'-style hint from a rate-limit error body."""
    match = re.search(r"reset after\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?", str(exc), re.IGNORECASE)
    if not match:
        return None
    h, m, s = (int(v) if v else 0 for v in match.groups())
    total = h * 3600 + m * 60 + s
    return float(total) if total > 0 else None


async def load_ai_settings(session: AsyncSession) -> AISettings:
    """Effective AI settings: env defaults overlaid with app_settings rows."""
    settings = get_ai_settings().model_copy()
    rows = (
        await session.exec(select(AppSetting).where(AppSetting.key.in_(OVERRIDABLE_KEYS)))
    ).all()
    for row in rows:
        setattr(settings, row.key, row.value)
    return settings


async def save_ai_settings(session: AsyncSession, updates: dict[str, str | None]) -> None:
    """Upsert overrides; None/"" removes an override (falls back to env)."""
    for key, value in updates.items():
        existing = await session.get(AppSetting, key)
        if value is None or value == "":
            if existing is not None:
                await session.delete(existing)
        elif existing is None:
            session.add(AppSetting(key=key, value=value))
        else:
            existing.value = value
            existing.updated_at = utc_now()
    await session.commit()


def _is_transient_error(exc: Exception) -> bool:
    """True for 429/5xx (incl. gateways that mask upstream 429s as 503) and
    connection-level failures — the failure modes of local gateways."""
    if isinstance(exc, ModelHTTPError):
        return exc.status_code == 429 or exc.status_code >= 500
    return isinstance(exc, ModelAPIError)  # connect/timeout errors


def _is_quota_error(exc: Exception) -> bool:
    if not isinstance(exc, ModelHTTPError):
        return False
    body = str(exc.body)
    return exc.status_code == 429 or "RESOURCE_EXHAUSTED" in body or "quota" in body.lower()


async def _retry_delay(exc: Exception, attempt: int) -> float | None:
    """Seconds to wait before retry #attempt+1; None = give up.

    Quota errors get ONE retry timed to the gateway's own reset hint; other
    transient errors walk the short backoff ladder.
    """
    if not _is_transient_error(exc):
        return None
    if _is_quota_error(exc):
        if attempt > 0:
            return None
        hint = _reset_hint_seconds(exc)
        return min(hint + 5.0, RESET_RETRY_CAP_SECONDS) if hint is not None else None
    return RETRY_BACKOFF_SECONDS[attempt] if attempt < len(RETRY_BACKOFF_SECONDS) else None


class ResilientModel(WrapperModel):
    """Retries transient HTTP errors (429/5xx) with spaced backoff.

    pydantic-ai's `retries=` only covers validation/tool retries, and the OpenAI
    SDK's built-in retry budget is tiny — one burst from a small-quota gateway
    would otherwise fail the whole rollup. Streaming retries only apply while
    the wrapped request is still being set up (context enter raises before we
    yield); once handed to the consumer, a stream that dies is never silently
    restarted.
    """

    async def request(self, messages, model_settings, model_request_parameters):  # type: ignore[override]
        attempt = 0
        while True:
            try:
                return await self.wrapped.request(messages, model_settings, model_request_parameters)
            except Exception as exc:
                delay = await _retry_delay(exc, attempt)
                if delay is None:
                    raise
                attempt += 1
                await asyncio.sleep(delay)

    @asynccontextmanager
    async def request_stream(self, messages, model_settings, model_request_parameters, run_context=None):  # type: ignore[override]
        attempt = 0
        while True:
            yielded = False
            try:
                async with self.wrapped.request_stream(
                    messages, model_settings, model_request_parameters, run_context
                ) as stream:
                    yielded = True
                    yield stream
                    return
            except Exception as exc:
                delay = None if yielded else await _retry_delay(exc, attempt)
                if delay is None:
                    raise
                attempt += 1
                await asyncio.sleep(delay)


def describe_ai_error(exc: Exception) -> str:
    """Human-readable one-liner for the settings test UI / API error details."""
    if isinstance(exc, ModelHTTPError):
        body = str(exc.body)
        if exc.status_code == 429 or "RESOURCE_EXHAUSTED" in body or "quota" in body.lower():
            reset = re.search(r"reset after [\dhms ]+", body, re.IGNORECASE)
            window = f" (resets in {reset.group(0).removeprefix('reset after ').strip()})" if reset else ""
            return f"Provider rate limit reached{window}. Wait a few minutes and retry."
        if exc.status_code in (401, 403):
            return "Authentication failed — check the API key for this endpoint."
        if exc.status_code == 404:
            return "Endpoint or model not found — check base URL and model name."
        return f"Provider returned HTTP {exc.status_code}: {body[:200]}"
    if isinstance(exc, ModelAPIError):
        return "Could not reach the AI endpoint — is the service running?"
    name = type(exc).__name__
    if "Connect" in name or "Timeout" in name:
        return "Could not reach the AI endpoint — is the service running?"
    return str(exc)[:300]


async def load_prompt_overrides(session: AsyncSession) -> dict[str, str]:
    """System-prompt overrides keyed by agent (only keys with a non-empty override)."""
    rows = (
        await session.exec(select(AppSetting).where(AppSetting.key.in_([f"prompt_{k}" for k in PROMPT_KEYS])))
    ).all()
    return {row.key.removeprefix("prompt_"): row.value for row in rows if row.value.strip()}


async def save_prompt_override(session: AsyncSession, agent: str, value: str | None) -> None:
    """Set (or clear with None/"") one agent's prompt override."""
    await save_ai_settings(session, {f"prompt_{agent}": value})


def create_agent_model(settings: AISettings | None = None, resilient: bool = True, fast: bool = False) -> Model:
    """Instantiate a pydantic-ai model from the given (or env) settings.

    resilient=True wraps the provider model in ResilientModel; the connection
    test passes False so misconfiguration fails fast with a clear message.
    fast=True routes to the cheap tier (ai_fast_model_name), falling back to
    the main model when unset.
    """
    s = settings or get_ai_settings()
    model_name = s.ai_fast_model_name or s.ai_model_name if fast else s.ai_model_name

    if s.ai_provider == "anthropic":
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        model: Model = AnthropicModel(
            model_name,
            provider=AnthropicProvider(api_key=s.ai_api_key, base_url=s.ai_base_url),
        )
    else:
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider

        model = OpenAIChatModel(
            model_name,
            provider=OpenAIProvider(
                base_url=s.ai_base_url or "https://api.openai.com/v1",
                api_key=s.ai_api_key or "not-needed",
            ),
        )
    return ResilientModel(model) if resilient else model
