from __future__ import annotations

from datetime import date as Date
from datetime import datetime
from typing import Annotated, Literal

from pydantic import StringConstraints, field_validator
from sqlmodel import Field, SQLModel

from app.util import normalize_dt

TaskStatus = Literal["todo", "in_progress", "completed", "canceled"]
FocusType = Literal["pomodoro", "stopwatch"]

HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
ShortText = Annotated[str, StringConstraints(min_length=1, max_length=120)]
TitleText = Annotated[str, StringConstraints(min_length=1, max_length=500)]
NonNegativeInt = Annotated[int, Field(ge=0)]
PositiveInt = Annotated[int, Field(ge=1)]
PriorityInt = Annotated[int, Field(ge=0, le=3)]  # 0 none, 1 low (!3), 2 med (!2), 3 high (!1)


# --- Lists ---
class ListCreate(SQLModel):
    name: ShortText
    color: HexColor = "#64748b"
    icon: str | None = None
    is_favorite: bool = False


class ListUpdate(SQLModel):
    name: ShortText | None = None
    color: HexColor | None = None
    icon: str | None = None
    is_favorite: bool | None = None


# --- Tasks ---
class TaskCreate(SQLModel):
    title: TitleText
    list_id: str | None = None
    parent_id: str | None = None
    description: str | None = None
    priority: PriorityInt = 0
    status: TaskStatus = "todo"
    due_date: datetime | None = None
    estimated_minutes: NonNegativeInt | None = None
    recurrence_rule: str | None = None
    tags: list[str] = Field(default_factory=list)

    @field_validator("due_date")
    @classmethod
    def _due_to_utc(cls, v: datetime | None) -> datetime | None:
        return normalize_dt(v)


class TaskUpdate(SQLModel):
    title: TitleText | None = None
    description: str | None = None
    priority: PriorityInt | None = None
    status: TaskStatus | None = None
    due_date: datetime | None = None
    estimated_minutes: NonNegativeInt | None = None
    recurrence_rule: str | None = None
    tags: list[str] | None = None
    list_id: str | None = None
    parent_id: str | None = None

    @field_validator("due_date")
    @classmethod
    def _due_to_utc(cls, v: datetime | None) -> datetime | None:
        return normalize_dt(v)


class TaskReorder(SQLModel):
    parent_id: str | None = None
    list_id: str | None = None
    ordered_ids: list[TitleText]


# --- Focus ---
class FocusSessionCreate(SQLModel):
    task_id: str | None = None
    duration_minutes: PositiveInt
    session_type: FocusType = "pomodoro"
    notes: str | None = None
    created_at: datetime | None = None  # allows backfilling past sessions

    @field_validator("created_at")
    @classmethod
    def _created_to_utc(cls, v: datetime | None) -> datetime | None:
        return normalize_dt(v)


class FocusSummary(SQLModel):
    date: Date
    total_minutes: NonNegativeInt
    sessions: NonNegativeInt


# --- Habits ---
class HabitCreate(SQLModel):
    name: ShortText
    target_frequency: ShortText = "daily"  # daily | weekdays | 3x_week | ...


class HabitLogUpsert(SQLModel):
    date: Date
    completed: bool = True


# --- Journal ---
MoodInt = Annotated[int, Field(ge=1, le=5)]


class JournalUpsert(SQLModel):
    raw_markdown: str
    mood: MoodInt | None = None
    energy: MoodInt | None = None


# --- AI settings ---
class AISettingsUpdate(SQLModel):
    provider: str | None = None
    model_name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
