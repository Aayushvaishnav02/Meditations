"""Deterministic daily scoring (plan §3.4).

    Daily Score = 0.40*task + 0.35*focus + 0.15*habit + clamp(llm_nudge, ±10)

Components are 0-100. A component the user has not opted into is neutral
(100) rather than punitive:
  - no habits scheduled that day -> habit component = 100
  - target focus hours <= 0      -> focus component = 100
The task component follows the plan formula verbatim
(min(100, done/max(planned,1)*100)), so a day with nothing planned scores
0 on that component.
"""

from __future__ import annotations

from pydantic import BaseModel

WEIGHT_TASK = 0.40
WEIGHT_FOCUS = 0.35
WEIGHT_HABIT = 0.15
NUDGE_LIMIT = 10.0
DEFAULT_TARGET_DEEP_WORK_HOURS = 4.0


class DailyMetrics(BaseModel):
    tasks_completed: int = 0
    tasks_planned: int = 0
    deep_work_hours: float = 0.0
    habits_completed: int = 0
    habits_scheduled: int = 0


class ScoreBreakdown(BaseModel):
    task_score: float
    focus_score: float
    habit_score: float
    weighted_score: float
    llm_nudge: float
    final_score: float
    target_deep_work_hours: float
    metrics: DailyMetrics


def clamp_nudge(nudge: float) -> float:
    return max(-NUDGE_LIMIT, min(NUDGE_LIMIT, nudge))


def task_completion_score(m: DailyMetrics) -> float:
    return min(100.0, (m.tasks_completed / max(m.tasks_planned, 1)) * 100.0)


def deep_work_score(m: DailyMetrics, target_hours: float) -> float:
    if target_hours <= 0:  # focus tracking disabled -> neutral
        return 100.0
    return min(100.0, (m.deep_work_hours / target_hours) * 100.0)


def habit_consistency_score(m: DailyMetrics) -> float:
    if m.habits_scheduled <= 0:  # no habits configured -> neutral
        return 100.0
    return min(100.0, (m.habits_completed / m.habits_scheduled) * 100.0)


def compute_daily_score(
    m: DailyMetrics,
    target_hours: float = DEFAULT_TARGET_DEEP_WORK_HOURS,
    llm_nudge: float = 0.0,
) -> ScoreBreakdown:
    t = task_completion_score(m)
    f = deep_work_score(m, target_hours)
    h = habit_consistency_score(m)
    weighted = WEIGHT_TASK * t + WEIGHT_FOCUS * f + WEIGHT_HABIT * h
    nudge = clamp_nudge(llm_nudge)
    final = min(100.0, max(0.0, weighted + nudge))
    return ScoreBreakdown(
        task_score=t,
        focus_score=f,
        habit_score=h,
        weighted_score=weighted,
        llm_nudge=nudge,
        final_score=final,
        target_deep_work_hours=target_hours,
        metrics=m,
    )
