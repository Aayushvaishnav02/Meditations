from __future__ import annotations

import time

from fastapi import APIRouter, Query
from pydantic import BaseModel
from pydantic_ai import Agent
from sqlmodel import SQLModel

from app.ai_factory import create_agent_model, describe_ai_error, load_ai_settings
from app.models import AppSetting
from app.routers.deps import SessionDep
from app.util import utc_now

router = APIRouter(prefix="/api/settings", tags=["settings"])

TARGET_HOURS_KEY = "target_deep_work_hours"
DEFAULT_TARGET_HOURS = 4.0


# --- AI provider configuration (masked; the key itself never leaves the server) ---
class AIConnectionTest(BaseModel):
    ok: bool
    model: str
    reply: str | None = None
    latency_ms: int | None = None
    error: str | None = None


@router.post("/ai/test", response_model=AIConnectionTest)
async def test_ai_connection(session: SessionDep):
    """One tiny completion against the effective settings; 200 with ok=false on
    failure so the UI can render the error inline."""
    settings = await load_ai_settings(session)
    started = time.monotonic()
    try:
        agent: Agent[None, str] = Agent(
            create_agent_model(settings),
            output_type=str,
            system_prompt='Reply with exactly: OK',
            retries=0,
        )
        result = await agent.run("ping")
        return AIConnectionTest(
            ok=True,
            model=settings.ai_model_name,
            reply=result.output.strip()[:80],
            latency_ms=int((time.monotonic() - started) * 1000),
        )
    except Exception as exc:  # noqa: BLE001 — the whole point is surfacing the error
        return AIConnectionTest(
            ok=False,
            model=settings.ai_model_name,
            error=describe_ai_error(exc),
            latency_ms=int((time.monotonic() - started) * 1000),
        )


# --- app preferences (keyed app_settings with typed accessors) ---
class AppPrefs(SQLModel):
    """Deep-work hours target feeds the deterministic score (plan §3.4)."""

    target_deep_work_hours: float


@router.get("/app", response_model=AppPrefs)
async def get_prefs(session: SessionDep):
    row = await session.get(AppSetting, TARGET_HOURS_KEY)
    try:
        target = float(row.value) if row else DEFAULT_TARGET_HOURS
    except ValueError:
        target = DEFAULT_TARGET_HOURS
    return AppPrefs(target_deep_work_hours=target)


class AppPrefsUpdate(BaseModel):
    target_deep_work_hours: float | None = Query(default=None, gt=0, le=16)


@router.put("/app", response_model=AppPrefs)
async def set_prefs(payload: AppPrefsUpdate, session: SessionDep):
    if payload.target_deep_work_hours is not None:
        row = await session.get(AppSetting, TARGET_HOURS_KEY)
        if row is None:
            row = AppSetting(key=TARGET_HOURS_KEY, value=str(payload.target_deep_work_hours))
        else:
            row.value = str(payload.target_deep_work_hours)
            row.updated_at = utc_now()
        session.add(row)
        await session.commit()
    return await get_prefs(session)


async def get_effective_target_hours(session: SessionDep) -> float:
    row = await session.get(AppSetting, TARGET_HOURS_KEY)
    if row is not None:
        try:
            return max(0.01, float(row.value))
        except ValueError:
            pass
    return DEFAULT_TARGET_HOURS
