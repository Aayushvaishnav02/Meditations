from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import SQLModel, select

from app.ai_factory import (
    OVERRIDABLE_KEYS,
    load_ai_settings,
    load_prompt_overrides,
    save_ai_settings,
)
from app.agents import PROMPT_DEFAULTS
from app.config import AISettings
from app.models import AiUsage
from app.routers.deps import SessionDep
from app.schemas import AISettingsUpdate
from app.util import utc_now

router = APIRouter(prefix="/api/settings/ai", tags=["settings"])

_FIELD_TO_KEY = {
    "provider": "ai_provider",
    "model_name": "ai_model_name",
    "fast_model_name": "ai_fast_model_name",
    "base_url": "ai_base_url",
    "api_key": "ai_api_key",
}


class AISettingsView(SQLModel):
    """Effective config; the API key itself is never returned."""

    provider: str
    model_name: str
    fast_model_name: str | None
    base_url: str | None
    api_key_set: bool


def _view(settings: AISettings) -> AISettingsView:
    return AISettingsView(
        provider=settings.ai_provider,
        model_name=settings.ai_model_name,
        fast_model_name=settings.ai_fast_model_name,
        base_url=settings.ai_base_url,
        api_key_set=bool(settings.ai_api_key),
    )


@router.get("", response_model=AISettingsView)
async def get_ai_config(session: SessionDep):
    return _view(await load_ai_settings(session))


@router.put("", response_model=AISettingsView)
async def update_ai_config(payload: AISettingsUpdate, session: SessionDep):
    """Set overrides; send "" to clear a field back to its env default."""
    updates = {
        _FIELD_TO_KEY[field]: value
        for field, value in payload.model_dump(exclude_unset=True).items()
    }
    await save_ai_settings(session, updates)
    return _view(await load_ai_settings(session))


@router.delete("", response_model=AISettingsView)
async def reset_ai_config(session: SessionDep):
    """Drop all DB overrides so env/.env values apply again."""
    await save_ai_settings(session, {key: None for key in OVERRIDABLE_KEYS})
    return _view(await load_ai_settings(session))


# --- system-prompt overrides ---
class PromptEntry(SQLModel):
    key: str
    default: str
    override: str | None


class PromptsView(SQLModel):
    prompts: list[PromptEntry]


class PromptsUpdate(SQLModel):
    overrides: dict[str, str | None]  # key → new text, or None/"" to reset


@router.get("/prompts", response_model=PromptsView)
async def get_prompts(session: SessionDep):
    overrides = await load_prompt_overrides(session)
    return PromptsView(
        prompts=[
            PromptEntry(key=key, default=default, override=overrides.get(key))
            for key, default in PROMPT_DEFAULTS.items()
        ]
    )


@router.put("/prompts", response_model=PromptsView)
async def update_prompts(payload: PromptsUpdate, session: SessionDep):
    unknown = set(payload.overrides) - set(PROMPT_DEFAULTS)
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown prompt keys: {sorted(unknown)}")
    for key, value in payload.overrides.items():
        await save_ai_settings(session, {f"prompt_{key}": value})
    return await get_prompts(session)


# --- token/duration usage (observability only) ---
class UsageByAgent(SQLModel):
    agent: str
    calls: int
    input_tokens: int
    output_tokens: int


class UsageView(SQLModel):
    days: int
    calls: int
    input_tokens: int
    output_tokens: int
    by_agent: list[UsageByAgent]


@router.get("/usage", response_model=UsageView)
async def get_usage(session: SessionDep, days: int = Query(default=7, ge=1, le=90)):
    since = utc_now() - dt.timedelta(days=days)
    rows = (
        await session.exec(select(AiUsage).where(AiUsage.ts >= since).order_by(AiUsage.ts))
    ).all()
    per_agent: dict[str, UsageByAgent] = {}
    for r in rows:
        agg = per_agent.setdefault(r.agent, UsageByAgent(agent=r.agent, calls=0, input_tokens=0, output_tokens=0))
        agg.calls += 1
        agg.input_tokens += r.input_tokens
        agg.output_tokens += r.output_tokens
    return UsageView(
        days=days,
        calls=len(rows),
        input_tokens=sum(r.input_tokens for r in rows),
        output_tokens=sum(r.output_tokens for r in rows),
        by_agent=list(per_agent.values()),
    )
