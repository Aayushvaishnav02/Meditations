from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query
from sqlmodel import SQLModel

from app.models import DailyScore
from app.routers.deps import SessionDep
from app.scoring import (
    DEFAULT_TARGET_DEEP_WORK_HOURS,
    DailyMetrics,
    ScoreBreakdown,
    compute_daily_score,
)
from app.telemetry import collect_daily_metrics

router = APIRouter(prefix="/api/scores", tags=["scores"])


class DailyScoreResponse(SQLModel):
    date: date
    task_score: float
    focus_score: float
    habit_score: float
    weighted_score: float
    llm_nudge: float
    final_score: float
    target_deep_work_hours: float
    metrics: DailyMetrics
    persisted: bool = False
    feedback: str | None = None
    insight: str | None = None


def _response(day: date, breakdown: ScoreBreakdown, persisted: bool, feedback: str | None, insight: str | None) -> DailyScoreResponse:
    return DailyScoreResponse(
        date=day,
        task_score=breakdown.task_score,
        focus_score=breakdown.focus_score,
        habit_score=breakdown.habit_score,
        weighted_score=breakdown.weighted_score,
        llm_nudge=breakdown.llm_nudge,
        final_score=breakdown.final_score,
        target_deep_work_hours=breakdown.target_deep_work_hours,
        metrics=breakdown.metrics,
        persisted=persisted,
        feedback=feedback,
        insight=insight,
    )


@router.get("/daily/{day}", response_model=DailyScoreResponse)
async def get_daily_score(
    day: date,
    session: SessionDep,
    target_hours: float | None = Query(default=None, gt=0),
):
    """Live deterministic score; uses the stored LLM nudge if a rollup exists.

    Persistence of daily_scores rows happens with the daily agent (Phase 4).
    """
    metrics = await collect_daily_metrics(session, day)
    target = target_hours if target_hours is not None else DEFAULT_TARGET_DEEP_WORK_HOURS

    stored = await session.get(DailyScore, day)
    if stored is not None:
        breakdown = compute_daily_score(metrics, target_hours=target, llm_nudge=stored.llm_nudge)
        return _response(day, breakdown, persisted=True, feedback=stored.feedback, insight=stored.insight)

    breakdown = compute_daily_score(metrics, target_hours=target)
    return _response(day, breakdown, persisted=False, feedback=None, insight=None)
