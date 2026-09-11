"""Builds pydantic-ai model instances from env + DB settings (plan §3.2/§7.1).

pydantic-ai v2 API note: OpenAIModel was renamed OpenAIChatModel and both
model classes now take a provider object carrying base_url/api_key; agents
use output_type= (formerly result_type=).
"""

from __future__ import annotations

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import AISettings, get_ai_settings
from app.models import AppSetting
from app.util import utc_now

OVERRIDABLE_KEYS = ("ai_provider", "ai_model_name", "ai_base_url", "ai_api_key")


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


def create_agent_model(settings: AISettings | None = None):
    """Instantiate a pydantic-ai model from the given (or env) settings."""
    s = settings or get_ai_settings()

    if s.ai_provider == "anthropic":
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        return AnthropicModel(
            s.ai_model_name,
            provider=AnthropicProvider(api_key=s.ai_api_key, base_url=s.ai_base_url),
        )

    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.openai import OpenAIProvider

    return OpenAIChatModel(
        s.ai_model_name,
        provider=OpenAIProvider(
            base_url=s.ai_base_url or "https://api.openai.com/v1",
            api_key=s.ai_api_key or "not-needed",
        ),
    )
