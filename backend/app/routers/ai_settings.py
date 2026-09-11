from __future__ import annotations

from fastapi import APIRouter
from sqlmodel import SQLModel

from app.ai_factory import OVERRIDABLE_KEYS, load_ai_settings, save_ai_settings
from app.config import AISettings
from app.routers.deps import SessionDep
from app.schemas import AISettingsUpdate

router = APIRouter(prefix="/api/settings/ai", tags=["settings"])

_FIELD_TO_KEY = {
    "provider": "ai_provider",
    "model_name": "ai_model_name",
    "base_url": "ai_base_url",
    "api_key": "ai_api_key",
}


class AISettingsView(SQLModel):
    """Effective config; the API key itself is never returned."""

    provider: str
    model_name: str
    base_url: str | None
    api_key_set: bool


def _view(settings: AISettings) -> AISettingsView:
    return AISettingsView(
        provider=settings.ai_provider,
        model_name=settings.ai_model_name,
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
