"""AI agents for hierarchical journal compaction (plan §3.3, §7).

Bounded-memory scheme:
  daily   agent reads today's raw entry + past 6 days (truncated) + latest
          weekly/monthly summaries  -> O(1) token footprint
  weekly  agent reads 7 daily scores/metadata + last 4 weekly summaries
          + latest monthly  (raw daily text is never read again)
  monthly agent reads this month's weekly summaries + last 3 monthly summaries

Scores stay deterministic (app.scoring); the LLM may shift a day's score by at
most ±10 with an explicit rationale (plan §3.4).

All runners take an optional `model` for testing (pydantic-ai TestModel /
FunctionModel) — the default resolves the runtime-configured provider via
app.ai_factory.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

from pydantic import BaseModel, Field
from pydantic_ai import Agent

from app.ai_factory import create_agent_model


# --- structured outputs ---
class DailyReviewOutput(BaseModel):
    llm_nudge: float = Field(
        default=0.0, ge=-10, le=10, description="Bounded qualitative score adjustment with explicit justification"
    )
    nudge_rationale: str = Field(default="", description="Why the adjustment was (or wasn't) applied")
    feedback: str = Field(default="", description="Direct, constructive feedback on the day's execution")
    key_insight: str = Field(default="", description="One high-leverage observation or behavioural pattern")
    suggested_action_for_tomorrow: str = Field(default="", description="Single most important recommendation")


class WeeklyReviewOutput(BaseModel):
    wins: str = Field(default="", description="Primary wins of the week, one per line")
    misses: str = Field(default="", description="Friction points and misses, one per line")
    carried_action_items: str = Field(default="", description="Concrete items/habits to carry into next week")


class MonthlyReviewOutput(BaseModel):
    narrative: str = Field(default="", description="High-level narrative of the month: patterns, growth, trends")


class SubtaskItem(BaseModel):
    title: str
    estimated_minutes: int = Field(ge=5, le=240)
    priority: int = Field(default=0, ge=0, le=3)


class DecompositionOutput(BaseModel):
    subtasks: list[SubtaskItem]
    advice: str = Field(default="", description="One short line of strategy advice")


class CapturedTask(BaseModel):
    title: str
    due_date: str | None = Field(default=None, description="ISO date YYYY-MM-DD or null")
    due_time: str | None = Field(default=None, description="24h time HH:MM or null")
    priority: int = Field(default=0, ge=0, le=3)
    tags: list[str] = Field(default_factory=list)


class CaptureOutput(BaseModel):
    tasks: list[CapturedTask]
    journal_snippet: str = Field(default="", description="Short neutral note worth keeping in today's journal")


class BriefingOutput(BaseModel):
    top_focus: list[str] = Field(description="The Top 3 priorities for today, each one concrete sentence")
    reasoning: str = Field(default="", description="Why these three, referencing capacity and carry-over")


# --- dependencies / prompt context ---
@dataclass
class DailyDeps:
    day: dt.date
    today_raw: str
    past_days: list[dict] = field(default_factory=list)  # [{date, score, raw}]
    weekly_context: str | None = None
    monthly_context: str | None = None
    metrics: dict = field(default_factory=dict)


@dataclass
class WeeklyDeps:
    week_start: dt.date
    days: list[dict] = field(default_factory=list)  # [{date, score, tasks_done, tasks_planned, deep_work_hours}]
    past_weeks: list[dict] = field(default_factory=list)  # [{week_start, avg_score, wins, misses, carried}]
    monthly_context: str | None = None
    trend: str = "stable"


@dataclass
class MonthlyDeps:
    month: str  # YYYY-MM
    weeks: list[dict] = field(default_factory=list)  # [{week_start, avg_score, trend, wins, misses, carried}]
    past_months: list[dict] = field(default_factory=list)  # [{month, avg_score, trend, narrative}]
    trend: str = "stable"


DAILY_SYSTEM = (
    "You are an executive personal coach and productivity analyst. You analyse a daily journal"
    " entry, its deterministic telemetry (task completion rate, deep-work hours, habit"
    " consistency) and the bounded context of recent weeks. Your role is not to flatter, but to"
    " provide rigorous, actionable, empathetic analysis. You may adjust the deterministic score"
    " with a nudge between -10 and +10 when the raw numbers miss something important (e.g. an"
    " emergency handled well, rest that was earned, procrastination despite a light day)."
    " Justify every nudge. Never restate the numbers without interpreting them."
)

WEEKLY_SYSTEM = (
    "You are an executive personal coach reviewing a full week. You receive deterministic daily"
    " scores and metadata (never raw journals) plus a bounded history of prior weeks. Diagnose"
    " patterns: where energy went, what consistently blocked execution, what deserves to carry"
    " into next week. Be concrete and honest; one item per line for wins and misses."
)

MONTHLY_SYSTEM = (
    "You are an executive personal coach reviewing a month at altitude. You receive this month's"
    " weekly rollups and a bounded history of prior months. Write a compact narrative of macro"
    " trends, growth and drift. No bullet points; a few tight paragraphs."
)

DECOMPOSE_SYSTEM = (
    "You decompose complex goals into atomic, actionable subtasks of 5 to 240 minutes each."
    " Order matters: sequence them execution-first. Suggest priorities (0 none, 1 low, 2 medium,"
    " 3 high) and realistic estimates. Today's date is provided for contextual phrasing."
)

CAPTURE_SYSTEM = (
    "You extract structure from an unstructured brain-dump. Turn each concrete commitment into a"
    " task with an ISO due date resolved relative to today (e.g. 'Thursday' -> the upcoming"
    " Thursday). Extract priorities (!1 high .. !3 low), @tags and estimated duration hints if"
    " present. The journal snippet is a short, neutral, first-person record of what happened or"
    " was decided (no tasks repeated). If there is nothing worth recording, return no tasks and"
    " an empty snippet."
)

BRIEFING_SYSTEM = (
    "You are the user's chief of staff preparing their morning brief. Given overdue work, today's"
    " due tasks and yesterday's reflection, choose the Top 3 priorities that make today a success."
    " Each is one concrete sentence, ideally tied to a specific task. Consider capacity honestly:"
    " three achievable items beat seven aspirational ones."
)


async def run_daily_review(deps: DailyDeps, model=None) -> DailyReviewOutput:
    agent: Agent[None, DailyReviewOutput] = Agent(
        model or create_agent_model(),
        output_type=DailyReviewOutput,
        system_prompt=DAILY_SYSTEM,
        retries=2,
    )
    parts = [
        "--- BOUNDED CONTEXT (never grows with history) ---",
        f"Monthly context: {deps.monthly_context or 'none yet.'}",
        f"Weekly context: {deps.weekly_context or 'none yet.'}",
        "Past 6 days (date | score | raw excerpt):",
    ]
    for d in deps.past_days:
        score = d.get("score")
        parts.append(f"- {d['date']} | {round(score, 1) if score is not None else 'not scored'} | {d['raw'][:500]}")
    parts.append(f"Deterministic metrics today: {deps.metrics}")
    parts.append("Today's raw journal entry:")
    parts.append(f'"""{deps.today_raw[:4000]}"""')
    result = await agent.run("\n".join(parts))
    return result.output


async def run_weekly_review(deps: WeeklyDeps, model=None) -> WeeklyReviewOutput:
    agent: Agent[None, WeeklyReviewOutput] = Agent(
        model or create_agent_model(),
        output_type=WeeklyReviewOutput,
        system_prompt=WEEKLY_SYSTEM,
        retries=2,
    )
    parts = [
        "--- BOUNDED CONTEXT ---",
        f"Latest monthly context: {deps.monthly_context or 'none yet.'}",
        f"Prior weekly rollups: {deps.past_weeks or 'none yet.'}",
        f"Computed trend for this week: {deps.trend}",
        "This week's days (date | score | tasks done/planned | deep-work hours):",
    ]
    for d in deps.days:
        score = d.get("score")
        parts.append(
            f"- {d['date']} | {round(score, 1) if score is not None else 'not scored'}"
            f" | {d['tasks_done']}/{d['tasks_planned']} | {d['deep_work_hours']}h"
        )
    result = await agent.run("\n".join(parts))
    return result.output


async def run_monthly_review(deps: MonthlyDeps, model=None) -> MonthlyReviewOutput:
    agent: Agent[None, MonthlyReviewOutput] = Agent(
        model or create_agent_model(),
        output_type=MonthlyReviewOutput,
        system_prompt=MONTHLY_SYSTEM,
        retries=2,
    )
    parts = [
        "--- BOUNDED CONTEXT ---",
        f"Prior monthly narratives: {deps.past_months or 'none yet.'}",
        f"Computed trend for this month: {deps.trend}",
        "This month's weekly rollups:",
    ]
    for w in deps.weeks:
        parts.append(f"- {w['week_start']} | avg {round(w['avg_score'], 1)} | {w['trend']} | wins: {w['wins'][:200]}")
    result = await agent.run("\n".join(parts))
    return result.output


async def run_task_decomposition(title: str, description: str | None, today: dt.date, model=None) -> DecompositionOutput:
    agent: Agent[None, DecompositionOutput] = Agent(
        model or create_agent_model(),
        output_type=DecompositionOutput,
        system_prompt=DECOMPOSE_SYSTEM,
        retries=2,
    )
    result = await agent.run(
        f"Today is {today.isoformat()}. Goal: {title}\n" + (f"Details: {description}" if description else "")
    )
    return result.output


async def run_capture(text: str, today: dt.date, model=None) -> CaptureOutput:
    agent: Agent[None, CaptureOutput] = Agent(
        model or create_agent_model(),
        output_type=CaptureOutput,
        system_prompt=CAPTURE_SYSTEM,
        retries=2,
    )
    result = await agent.run(f"Today is {today.isoformat()}.\n\n{text[:4000]}")
    return result.output


async def run_briefing(deps: dict, model=None) -> BriefingOutput:
    agent: Agent[None, BriefingOutput] = Agent(
        model or create_agent_model(),
        output_type=BriefingOutput,
        system_prompt=BRIEFING_SYSTEM,
        retries=2,
    )
    result = await agent.run(f"--- MORNING DATA ---\n{deps}")
    return result.output


__all__ = [
    "DailyDeps",
    "DailyReviewOutput",
    "MonthlyDeps",
    "MonthlyReviewOutput",
    "WeeklyDeps",
    "WeeklyReviewOutput",
    "run_briefing",
    "run_capture",
    "run_daily_review",
    "run_monthly_review",
    "run_task_decomposition",
    "run_weekly_review",
]
