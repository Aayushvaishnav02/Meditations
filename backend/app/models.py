from __future__ import annotations

from datetime import date as Date
from datetime import datetime

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.util import new_id, utc_now


class TaskList(SQLModel, table=True):
    __tablename__ = "lists"

    id: str = Field(default_factory=new_id, primary_key=True)
    name: str = Field(index=True)
    color: str = Field(default="#64748b")
    icon: str | None = None
    is_favorite: bool = False
    created_at: datetime = Field(default_factory=utc_now)


class Task(SQLModel, table=True):
    __tablename__ = "tasks"

    id: str = Field(default_factory=new_id, primary_key=True)
    list_id: str | None = Field(default=None, foreign_key="lists.id", ondelete="SET NULL", index=True)
    parent_id: str | None = Field(default=None, foreign_key="tasks.id", ondelete="CASCADE", index=True)
    title: str
    description: str | None = None
    priority: int = 0  # 0 none, 1 low (!3), 2 med (!2), 3 high (!1)
    status: str = Field(default="todo", index=True)  # todo|in_progress|completed|canceled
    due_date: datetime | None = Field(default=None, index=True)
    estimated_minutes: int | None = None
    actual_minutes: int = 0
    recurrence_rule: str | None = None  # RRULE string; expansion lands with the task UI
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    order_index: float = 0.0
    completed_at: datetime | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class FocusSession(SQLModel, table=True):
    __tablename__ = "focus_sessions"

    id: str = Field(default_factory=new_id, primary_key=True)
    task_id: str | None = Field(default=None, foreign_key="tasks.id", ondelete="SET NULL", index=True)
    duration_minutes: int
    session_type: str = Field(default="pomodoro")  # pomodoro | stopwatch
    notes: str | None = None
    created_at: datetime = Field(default_factory=utc_now, index=True)


class Habit(SQLModel, table=True):
    __tablename__ = "habits"

    id: str = Field(default_factory=new_id, primary_key=True)
    name: str = Field(index=True)
    target_frequency: str = Field(default="daily")  # daily | weekdays | 3x_week | ...
    created_at: datetime = Field(default_factory=utc_now)


class HabitLog(SQLModel, table=True):
    __tablename__ = "habit_logs"
    __table_args__ = (UniqueConstraint("habit_id", "date", name="uq_habit_log_day"),)

    id: str = Field(default_factory=new_id, primary_key=True)
    habit_id: str = Field(foreign_key="habits.id", ondelete="CASCADE", index=True)
    date: Date
    completed: bool = True


class JournalEntry(SQLModel, table=True):
    __tablename__ = "journal_entries"

    date: Date = Field(primary_key=True)
    raw_markdown: str
    mood: int | None = None  # 1..5, validated at the API layer
    energy: int | None = None
    hours_deep_work: float = 0.0
    tasks_planned: int = 0
    tasks_done: int = 0
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class DailyScore(SQLModel, table=True):
    __tablename__ = "daily_scores"

    date: Date = Field(primary_key=True, foreign_key="journal_entries.date", ondelete="CASCADE")
    deterministic_score: float
    llm_nudge: float = 0.0  # bounded [-10, +10]
    final_score: float
    rubric_breakdown_json: str
    feedback: str
    insight: str
    created_at: datetime = Field(default_factory=utc_now)


class WeeklySummary(SQLModel, table=True):
    __tablename__ = "weekly_summaries"

    week_start: Date = Field(primary_key=True)
    avg_score: float
    trend: str  # rising | declining | stable
    wins: str
    misses: str
    carried_action_items: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class MonthlySummary(SQLModel, table=True):
    __tablename__ = "monthly_summaries"

    month: str = Field(primary_key=True)  # 'YYYY-MM'
    avg_score: float
    trend: str
    narrative: str
    created_at: datetime = Field(default_factory=utc_now)


class AppSetting(SQLModel, table=True):
    """Key/value overrides for env config (AI provider, base_url, api_key, ...)."""

    __tablename__ = "app_settings"

    key: str = Field(primary_key=True)
    value: str
    updated_at: datetime = Field(default_factory=utc_now)


class AiUsage(SQLModel, table=True):
    """Token/duration telemetry for every LLM call (observability only)."""

    __tablename__ = "ai_usage"

    id: str = Field(default_factory=new_id, primary_key=True)
    ts: datetime = Field(default_factory=utc_now, index=True)
    agent: str = Field(index=True)  # daily | weekly | monthly | decompose | capture | briefing | ask | assist | test
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    duration_ms: int = 0
