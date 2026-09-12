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
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.usage import RunUsage

from app.ai_factory import create_agent_model
from app.util import utc_now

# Callback that persists one call's usage telemetry (router-provided, session-aware).
OnUsage = Callable[["UsageReport"], Awaitable[None]]


@dataclass
class UsageReport:
    agent: str
    model: str
    input_tokens: int
    output_tokens: int
    duration_ms: int


def _report(agent_name: str, model, usage: RunUsage, started: float) -> UsageReport:
    return UsageReport(
        agent=agent_name,
        model=getattr(model, "model_name", "?"),
        input_tokens=usage.input_tokens or 0,
        output_tokens=usage.output_tokens or 0,
        duration_ms=int((time.monotonic() - started) * 1000),
    )


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


class AssistOutput(BaseModel):
    text: str = Field(description="The rewritten/continued/summarized journal text in markdown")


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


@dataclass
class AskDeps:
    """Question + retrieved sources + bounded chat history (client-held)."""

    question: str
    context: str  # numbered source blocks, "" when nothing matched
    history: list[dict] = field(default_factory=list)  # [{role: user|assistant, content}] oldest-first


@dataclass
class AssistDeps:
    action: str  # improve | continue | summarize
    text: str


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

ASK_SYSTEM = (
    "You answer questions about the user's life using ONLY the retrieved journal excerpts and"
    " rollups provided as numbered sources. Ground every factual claim in a source and mark it"
    " with its citation like [1] or [2]. Synthesize across sources instead of quoting them at"
    " length. If the sources do not contain the answer, say so plainly — never invent entries."
    " Be warm but concise; a few sentences or a short list."
)

ASSIST_SYSTEMS = {
    "improve": (
        "You are a sharp, respectful editor for personal journal entries. Rewrite the given text"
        " to be clearer and better structured while keeping the author's voice, first person and"
        " every factual detail. Never invent events. Return only the rewritten markdown."
    ),
    "continue": (
        "You continue the user's personal journal entry naturally in their voice, first person,"
        " picking up mid-thought. Write one or two short paragraphs; do not repeat what is already"
        " written and do not invent specific events. Return only the continuation markdown."
    ),
    "summarize": (
        "You condense the given journal text into a short markdown summary preserving concrete"
        " facts, tasks and feelings. Return only the summary markdown."
    ),
}

# Registry for the settings UI: every overridable system prompt and its default.
PROMPT_DEFAULTS: dict[str, str] = {
    "daily": DAILY_SYSTEM,
    "weekly": WEEKLY_SYSTEM,
    "monthly": MONTHLY_SYSTEM,
    "decompose": DECOMPOSE_SYSTEM,
    "capture": CAPTURE_SYSTEM,
    "briefing": BRIEFING_SYSTEM,
    "ask": ASK_SYSTEM,
    "assist_improve": ASSIST_SYSTEMS["improve"],
    "assist_continue": ASSIST_SYSTEMS["continue"],
    "assist_summarize": ASSIST_SYSTEMS["summarize"],
}


def _build_agent(output_type, system_prompt: str, model=None, fast: bool = False) -> Agent:
    """Shared construction; fast=True routes to the cheap model tier."""
    return Agent(
        model or create_agent_model(fast=fast),
        output_type=output_type,
        system_prompt=system_prompt,
        retries=2,
    )


async def run_daily_review(
    deps: DailyDeps, model=None, system_prompt: str | None = None, on_usage: OnUsage | None = None
) -> DailyReviewOutput:
    agent = _build_agent(DailyReviewOutput, system_prompt or DAILY_SYSTEM, model)
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
    started = time.monotonic()
    result = await agent.run("\n".join(parts))
    if on_usage:
        await on_usage(_report("daily", agent.model, result.usage(), started))
    return result.output


async def run_weekly_review(
    deps: WeeklyDeps, model=None, system_prompt: str | None = None, on_usage: OnUsage | None = None
) -> WeeklyReviewOutput:
    agent = _build_agent(WeeklyReviewOutput, system_prompt or WEEKLY_SYSTEM, model)
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
    started = time.monotonic()
    result = await agent.run("\n".join(parts))
    if on_usage:
        await on_usage(_report("weekly", agent.model, result.usage(), started))
    return result.output


async def run_monthly_review(
    deps: MonthlyDeps, model=None, system_prompt: str | None = None, on_usage: OnUsage | None = None
) -> MonthlyReviewOutput:
    agent = _build_agent(MonthlyReviewOutput, system_prompt or MONTHLY_SYSTEM, model)
    parts = [
        "--- BOUNDED CONTEXT ---",
        f"Prior monthly narratives: {deps.past_months or 'none yet.'}",
        f"Computed trend for this month: {deps.trend}",
        "This month's weekly rollups:",
    ]
    for w in deps.weeks:
        parts.append(f"- {w['week_start']} | avg {round(w['avg_score'], 1)} | {w['trend']} | wins: {w['wins'][:200]}")
    started = time.monotonic()
    result = await agent.run("\n".join(parts))
    if on_usage:
        await on_usage(_report("monthly", agent.model, result.usage(), started))
    return result.output


async def run_task_decomposition(
    title: str, description: str | None, today: dt.date, model=None, system_prompt: str | None = None, on_usage: OnUsage | None = None
) -> DecompositionOutput:
    agent = _build_agent(DecompositionOutput, system_prompt or DECOMPOSE_SYSTEM, model)
    started = time.monotonic()
    result = await agent.run(
        f"Today is {today.isoformat()}. Goal: {title}\n" + (f"Details: {description}" if description else "")
    )
    if on_usage:
        await on_usage(_report("decompose", agent.model, result.usage(), started))
    return result.output


async def run_capture(
    text: str, today: dt.date, model=None, system_prompt: str | None = None, on_usage: OnUsage | None = None
) -> CaptureOutput:
    agent = _build_agent(CaptureOutput, system_prompt or CAPTURE_SYSTEM, model, fast=True)
    started = time.monotonic()
    result = await agent.run(f"Today is {today.isoformat()}.\n\n{text[:4000]}")
    if on_usage:
        await on_usage(_report("capture", agent.model, result.usage(), started))
    return result.output


async def run_briefing(
    deps: dict, model=None, system_prompt: str | None = None, on_usage: OnUsage | None = None
) -> BriefingOutput:
    agent = _build_agent(BriefingOutput, system_prompt or BRIEFING_SYSTEM, model, fast=True)
    started = time.monotonic()
    result = await agent.run(f"--- MORNING DATA ---\n{deps}")
    if on_usage:
        await on_usage(_report("briefing", agent.model, result.usage(), started))
    return result.output


# --- second brain Q&A (plan §6.3.5) ---
def render_ask_prompt(deps: AskDeps) -> str:
    parts = []
    if deps.history:
        lines = [
            f"{'User' if h.get('role') == 'user' else 'You'}: {str(h.get('content', ''))[:1000]}"
            for h in deps.history[-6:]
        ]
        parts.append("--- EARLIER IN THIS CONVERSATION ---\n" + "\n".join(lines))
    parts.append("--- SOURCES ---\n" + (deps.context or "No stored entries matched the question."))
    parts.append("--- QUESTION ---\n" + deps.question)
    return "\n\n".join(parts)


async def stream_ask(
    deps: AskDeps, model=None, system_prompt: str | None = None, on_usage: OnUsage | None = None
) -> AsyncIterator[str]:
    """Yield cumulative answer text; the caller streams it to the client."""
    agent = _build_agent(str, system_prompt or ASK_SYSTEM, model, fast=True)
    started = time.monotonic()
    async with agent.run_stream(render_ask_prompt(deps)) as result:
        async for text in result.stream_text(debounce_by=0.1):
            yield text
        usage = result.usage()
    if on_usage:
        await on_usage(_report("ask", agent.model, usage, started))


# --- journal editor assists ---
def render_assist_prompt(deps: AssistDeps) -> str:
    return f"Today is {utc_now().date().isoformat()}.\n\n--- JOURNAL TEXT ---\n\"\"\"{deps.text[:6000]}\"\"\""


async def stream_assist(
    deps: AssistDeps, model=None, system_prompt: str | None = None, on_usage: OnUsage | None = None
) -> AsyncIterator[str]:
    """Yield cumulative markdown for an editor assist action."""
    if deps.action not in ASSIST_SYSTEMS:
        raise ValueError(f"unknown assist action: {deps.action}")
    agent = _build_agent(AssistOutput, system_prompt or ASSIST_SYSTEMS[deps.action], model, fast=True)
    started = time.monotonic()
    async with agent.run_stream(render_assist_prompt(deps)) as result:
        async for text in result.stream_text(debounce_by=0.1):
            yield text
        usage = result.usage()
    if on_usage:
        await on_usage(_report("assist", agent.model, usage, started))


async def stream_daily_review(
    deps: DailyDeps, model=None, system_prompt: str | None = None, on_usage: OnUsage | None = None
) -> AsyncIterator[DailyReviewOutput]:
    """Yield progressively-validated DailyReviewOutput partials; last one is complete."""
    agent = _build_agent(DailyReviewOutput, system_prompt or DAILY_SYSTEM, model)
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
    started = time.monotonic()
    async with agent.run_stream("\n".join(parts)) as result:
        async for partial in result.stream_output(debounce_by=0.2):
            yield partial
        usage = result.usage()
    if on_usage:
        await on_usage(_report("daily", agent.model, usage, started))


async def stream_briefing(
    deps: dict, model=None, system_prompt: str | None = None, on_usage: OnUsage | None = None
) -> AsyncIterator[BriefingOutput]:
    """Yield progressively-validated BriefingOutput partials; last one is complete."""
    agent = _build_agent(BriefingOutput, system_prompt or BRIEFING_SYSTEM, model, fast=True)
    started = time.monotonic()
    async with agent.run_stream(f"--- MORNING DATA ---\n{deps}") as result:
        async for partial in result.stream_output(debounce_by=0.2):
            yield partial
        usage = result.usage()
    if on_usage:
        await on_usage(_report("briefing", agent.model, usage, started))


__all__ = [
    "AskDeps",
    "AssistDeps",
    "DailyDeps",
    "DailyReviewOutput",
    "MonthlyDeps",
    "MonthlyReviewOutput",
    "UsageReport",
    "WeeklyDeps",
    "WeeklyReviewOutput",
    "render_ask_prompt",
    "render_assist_prompt",
    "run_briefing",
    "run_capture",
    "run_daily_review",
    "run_monthly_review",
    "run_task_decomposition",
    "run_weekly_review",
    "stream_ask",
    "stream_assist",
    "stream_briefing",
    "stream_daily_review",
]
