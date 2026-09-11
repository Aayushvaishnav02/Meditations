"""Aggregates SQLite telemetry into DailyMetrics for a given day.

Deterministic semantics:
- tasks_completed:  tasks whose completed_at falls within the day (UTC).
- tasks_planned:    tasks that were on the plate that day: due before
                    end-of-day (incl. overdue, still open) OR undated and
                    completed that day; canceled tasks never count.
- deep_work_hours:  sum of focus session minutes logged that day.
- habits_scheduled: 'daily' habits that existed by end of that day.
- habits_completed: of those, with a completed log entry that day.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import and_, func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import FocusSession, Habit, HabitLog, Task
from app.scoring import DailyMetrics
from app.util import day_bounds


async def collect_daily_metrics(session: AsyncSession, day: date) -> DailyMetrics:
    start, end = day_bounds(day)

    tasks_completed = (
        await session.exec(
            select(func.count(Task.id)).where(
                Task.status == "completed",
                Task.completed_at >= start,
                Task.completed_at < end,
            )
        )
    ).one()

    tasks_planned = (
        await session.exec(
            select(func.count(Task.id)).where(
                Task.status != "canceled",
                or_(
                    and_(
                        Task.due_date.is_not(None),
                        Task.due_date < end,
                        or_(Task.completed_at.is_(None), Task.completed_at >= start),
                    ),
                    and_(
                        Task.due_date.is_(None),
                        Task.completed_at >= start,
                        Task.completed_at < end,
                    ),
                ),
            )
        )
    ).one()

    focus_minutes = (
        await session.exec(
            select(func.coalesce(func.sum(FocusSession.duration_minutes), 0)).where(
                FocusSession.created_at >= start,
                FocusSession.created_at < end,
            )
        )
    ).one()

    scheduled_habits = (
        await session.exec(
            select(Habit).where(Habit.target_frequency == "daily", Habit.created_at < end)
        )
    ).all()

    habits_completed = 0
    if scheduled_habits:
        habits_completed = (
            await session.exec(
                select(func.count(HabitLog.id)).where(
                    HabitLog.date == day,
                    HabitLog.completed.is_(True),
                    HabitLog.habit_id.in_([h.id for h in scheduled_habits]),
                )
            )
        ).one()

    return DailyMetrics(
        tasks_completed=tasks_completed,
        tasks_planned=tasks_planned,
        deep_work_hours=round(focus_minutes / 60.0, 4),
        habits_completed=habits_completed,
        habits_scheduled=len(scheduled_habits),
    )
