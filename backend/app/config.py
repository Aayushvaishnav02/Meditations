from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    """General app configuration (env: JOURNAL_DB_PATH)."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    journal_db_path: str = "data/journal.db"


class AISettings(BaseSettings):
    """AI provider config.

    Reads AI_* env vars (case-insensitive); individual fields can be
    overridden at runtime via the app_settings table (routers/ai_settings.py).
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ai_provider: str = "openai_compatible"  # "openai_compatible" | "anthropic"
    ai_model_name: str = "llama3.2:3b"
    ai_fast_model_name: str | None = None  # cheap tier for capture/briefing/assist; None = ai_model_name
    ai_base_url: str | None = "http://localhost:11434/v1"  # Ollama/OpenRouter/Groq/vLLM
    ai_api_key: str | None = "ollama"


@lru_cache
def get_app_settings() -> AppSettings:
    return AppSettings()


@lru_cache
def get_ai_settings() -> AISettings:
    return AISettings()
