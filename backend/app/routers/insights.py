"""Aggregated metrics for the insights dashboard.

Everything shown derives from plan.md's metric set (§3.4/§3.3/§1):
daily score series (deterministic + persisted nudges), task completion,
deep-work hours vs target, habit consistency + streaks, journaling streaks,
and the weekly/monthly rollup trends.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Query
from sqlmodel import SQLModel, select

from app.models import DailyScore, Habit, HabitLog, JournalEntry, MonthlySummary, WeeklySummary
from app.routers.deps import SessionDep
from app.routers.preferences import get_effective_target_hours
from app.scoring import compute_daily_score
from app.telemetry import collect_daily_metrics
from app.util import utc_now

router = APIRouter(prefix="/api/insights", tags=["insights"])


class InsightDay(SQLModel):
    date: dt.date
    score: float
    tasks_completed: int
    tasks_planned: int
    deep_work_hours: float
    habits_completed: int
    habits_scheduled: int
    mood: int | None
    energy: int | None


class HabitInsight(SQLModel):
    id: str
    name: str
    current_streak: int
    rate_30: float


class WeeklyTrend(SQLModel):
    week_start: dt.date
    avg_score: float
    trend: str


class MonthlyTrend(SQLModel):
    month: str
    avg_score: float
    trend: str


class InsightsResponse(SQLModel):
    days: int
    series: list[InsightDay]
    journaling_streak: int
    journaling_best: int
    habits: list[HabitInsight]
    weekly: list[WeeklyTrend]
    monthly: list[MonthlyTrend]
    totals: dict[str, float | int | None]


def _streaks(journaled: set[dt.date], today: dt.date) -> tuple[int, int]:
    """(current, best) consecutive-day journaling streaks."""
    probe = today if today in journaled else today - dt.timedelta(days=1)
    current = 0
    while probe in journaled:
        current += 1
        probe -= dt.timedelta(days=1)

    best = run = 0
    prev: dt.date | None = None
    for day in sorted(journaled):
        run = run + 1 if (prev is not None and (day - prev).days == 1) else 1
        best = max(best, run)
        prev = day
    return current, best


async def _habit_insights(session: SessionDep, today: dt.date) -> list[HabitInsight]:
    habits = (await session.exec(select(Habit).where(Habit.target_frequency == "daily"))).all()
    out: list[HabitInsight] = []
    month_ago = today - dt.timedelta(days=29)
    for habit in habits:
        done = {
            log.date
            for log in (
                await session.exec(
                    select(HabitLog).where(
                        HabitLog.habit_id == habit.id,
                        HabitLog.completed.is_(True),
                        HabitLog.date >= month_ago,
                    )
                )
            ).all()
        }
        streak = 0
        probe = today if today in done else today - dt.timedelta(days=1)
        while probe in done:
            streak += 1
            probe -= dt.timedelta(days=1)
        out.append(HabitInsight(id=habit.id, name=habit.name, current_streak=streak, rate_30=round(len(done) / 30, 3)))
    return out


@router.get("", response_model=InsightsResponse)
async def insights(session: SessionDep, days: int = Query(default=30, ge=14, le=90)):
    today = utc_now().date()
    start = today - dt.timedelta(days=days - 1)
    target_hours = await get_effective_target_hours(session)

    series: list[InsightDay] = []
    journaled: set[dt.date] = set()
    entries_by_date = {e.date: e for e in (await session.exec(select(JournalEntry).where(JournalEntry.date >= start - dt.timedelta(days=400)))).all()}
    scores_by_date = {s.date: s for s in (await session.exec(select(DailyScore).where(DailyScore.date >= start))).all()}

    for offset in range(days):
        day = start + dt.timedelta(days=offset)
        entry = entries_by_date.get(day)
        if entry is not None and entry.raw_markdown.strip():
            journaled.add(day)
        metrics = await collect_daily_metrics(session, day)
        stored = scores_by_date.get(day)
        score = stored.final_score if stored else compute_daily_score(metrics, target_hours=target_hours).weighted_score
        series.append(
            InsightDay(
                date=day,
                score=round(score, 2),
                tasks_completed=metrics.tasks_completed,
                tasks_planned=metrics.tasks_planned,
                deep_work_hours=metrics.deep_work_hours,
                habits_completed=metrics.habits_completed,
                habits_scheduled=metrics.habits_scheduled,
                mood=entry.mood if entry else None,
                energy=entry.energy if entry else None,
            )
        )

    streak_current, streak_best = _streaks(journaled, today)

    weekly = [
        WeeklyTrend(week_start=w.week_start, avg_score=w.avg_score, trend=w.trend)
        for w in (
            await session.exec(select(WeeklySummary).order_by(WeeklySummary.week_start.desc()).limit(8))
        ).all()
    ][::-1]
    monthly = [
        MonthlyTrend(month=m.month, avg_score=m.avg_score, trend=m.trend)
        for m in (
            await session.exec(select(MonthlySummary).order_by(MonthlySummary.month.desc()).limit(6))
        ).all()
    ][::-1]

    last7 = [s.score for s in series[-7:]]
    prev7 = [s.score for s in series[-14:-7]]
    totals = {
        "avg_score_7": round(sum(last7) / len(last7), 2),
        "avg_score_prev_7": round(sum(prev7) / len(prev7), 2) if prev7 else None,
        "total_focus_hours": round(sum(s.deep_work_hours for s in series), 2),
        "tasks_done": sum(s.tasks_completed for s in series),
        "completion_rate": round(
            sum(s.tasks_completed for s in series) / max(sum(s.tasks_planned for s in series), 1), 3
        ),
        "target_deep_work_hours": target_hours,
    }

    return InsightsResponse(
        days=days,
        series=series,
        journaling_streak=streak_current,
        journaling_best=streak_best,
        habits=await _habit_insights(session, today),
        weekly=weekly,
        monthly=monthly,
        totals=totals,
    )
