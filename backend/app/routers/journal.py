from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func
from sqlmodel import SQLModel, select

from app.models import FocusSession, Habit, HabitLog, JournalEntry, Task
from app.routers.deps import SessionDep
from app.schemas import JournalUpsert
from app.search import index_document, journal_doc_id, remove_document
from app.telemetry import collect_daily_metrics
from app.util import day_bounds, utc_now

router = APIRouter(prefix="/api/journal", tags=["journal"])


class ActivityTask(SQLModel):
    id: str
    title: str


class ActivityHabit(SQLModel):
    id: str
    name: str
    completed: bool


class JournalActivity(SQLModel):
    """Rollup powering the 'Day activity' embed in the journal editor."""

    date: date
    tasks_done: list[ActivityTask]
    tasks_planned: int
    focus_minutes: int
    focus_sessions: int
    habits: list[ActivityHabit]


async def _get_entry_or_404(session: SessionDep, day: date) -> JournalEntry:
    entry = await session.get(JournalEntry, day)
    if entry is None:
        raise HTTPException(status_code=404, detail="Journal entry not found")
    return entry



class JournalDay(SQLModel):
    date: date
    mood: int | None
    energy: int | None


# NOTE: static route must be declared before /{day} (FastAPI matches in order).
@router.get("/days", response_model=list[JournalDay])
async def list_entry_days(
    session: SessionDep,
    start: date = Query(alias="from"),
    end: date = Query(alias="to"),
):
    """Days that have journal entries in [from, to], with mood/energy for the
    journal calendar dots."""
    rows = (
        await session.exec(
            select(JournalEntry)
            .where(JournalEntry.date >= start, JournalEntry.date <= end)
            .order_by(JournalEntry.date.desc())
        )
    ).all()
    return [
        JournalDay(date=e.date, mood=e.mood, energy=e.energy)
        for e in rows
        if e.raw_markdown.strip() or e.mood is not None or e.energy is not None
    ]


@router.get("/{day}", response_model=JournalEntry)
async def get_entry(day: date, session: SessionDep):
    return await _get_entry_or_404(session, day)


@router.put("/{day}", response_model=JournalEntry)
async def upsert_entry(day: date, payload: JournalUpsert, session: SessionDep):
    """Create or update the entry for a day; telemetry fields are snapshotted
    server-side (hours_deep_work, tasks_planned/done) so the client cannot
    drift from the recorded sessions."""
    entry = await session.get(JournalEntry, day)
    if entry is None:
        entry = JournalEntry(date=day, raw_markdown=payload.raw_markdown, mood=payload.mood, energy=payload.energy)
    else:
        entry.raw_markdown = payload.raw_markdown
        entry.mood = payload.mood
        entry.energy = payload.energy
        entry.updated_at = utc_now()

    metrics = await collect_daily_metrics(session, day)
    entry.hours_deep_work = metrics.deep_work_hours
    entry.tasks_planned = metrics.tasks_planned
    entry.tasks_done = metrics.tasks_completed

    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    await index_document(session, journal_doc_id(day), "journal", entry.raw_markdown)
    await session.commit()
    return entry


@router.delete("/{day}", status_code=204)
async def delete_entry(day: date, session: SessionDep):
    entry = await _get_entry_or_404(session, day)
    await session.delete(entry)
    await session.commit()
    await remove_document(session, journal_doc_id(day))
    await session.commit()


@router.get("/{day}/activity", response_model=JournalActivity)
async def get_activity(day: date, session: SessionDep):
    start, end = day_bounds(day)
    metrics = await collect_daily_metrics(session, day)

    done_rows = (
        await session.exec(
            select(Task.id, Task.title)
            .where(
                Task.status == "completed",
                Task.completed_at >= start,
                Task.completed_at < end,
            )
            .order_by(Task.completed_at)
        )
    ).all()

    focus_minutes = (
        await session.exec(
            select(func.coalesce(func.sum(FocusSession.duration_minutes), 0)).where(
                FocusSession.created_at >= start,
                FocusSession.created_at < end,
            )
        )
    ).one()
    focus_sessions = (
        await session.exec(
            select(func.count(FocusSession.id)).where(
                FocusSession.created_at >= start,
                FocusSession.created_at < end,
            )
        )
    ).one()

    scheduled = (
        await session.exec(
            select(Habit).where(Habit.target_frequency == "daily", Habit.created_at < end)
        )
    ).all()
    logs = {
        log.habit_id: log.completed
        for log in (
            await session.exec(select(HabitLog).where(HabitLog.date == day))
        ).all()
    }
    habits = [
        ActivityHabit(id=h.id, name=h.name, completed=logs.get(h.id, False)) for h in scheduled
    ]

    return JournalActivity(
        date=day,
        tasks_done=[ActivityTask(id=row.id, title=row.title) for row in done_rows],
        tasks_planned=metrics.tasks_planned,
        focus_minutes=int(focus_minutes),
        focus_sessions=int(focus_sessions),
        habits=habits,
    )
