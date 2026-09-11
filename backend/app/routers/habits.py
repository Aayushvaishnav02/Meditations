from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException
from sqlmodel import select

from app.models import Habit, HabitLog
from app.routers.deps import SessionDep
from app.schemas import HabitCreate, HabitLogUpsert

router = APIRouter(prefix="/api/habits", tags=["habits"])


async def _get_habit_or_404(session: SessionDep, habit_id: str) -> Habit:
    habit = await session.get(Habit, habit_id)
    if habit is None:
        raise HTTPException(status_code=404, detail="Habit not found")
    return habit


# NOTE: static routes must be declared before /{habit_id} routes.
@router.get("", response_model=list[Habit])
async def list_habits(session: SessionDep):
    return (await session.exec(select(Habit).order_by(Habit.created_at, Habit.id))).all()


@router.post("", response_model=Habit, status_code=201)
async def create_habit(payload: HabitCreate, session: SessionDep):
    habit = Habit(**payload.model_dump())
    session.add(habit)
    await session.commit()
    await session.refresh(habit)
    return habit


@router.get("/logs", response_model=list[HabitLog])
async def list_logs(
    session: SessionDep,
    on_date: date | None = None,
    habit_id: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
):
    q = select(HabitLog)
    if on_date is not None:
        q = q.where(HabitLog.date == on_date)
    else:
        if from_date is not None:
            q = q.where(HabitLog.date >= from_date)
        if to_date is not None:
            q = q.where(HabitLog.date <= to_date)
    if habit_id is not None:
        q = q.where(HabitLog.habit_id == habit_id)
    return (await session.exec(q.order_by(HabitLog.date))).all()


@router.put("/{habit_id}/logs", response_model=HabitLog)
async def upsert_log(habit_id: str, payload: HabitLogUpsert, session: SessionDep):
    await _get_habit_or_404(session, habit_id)
    existing = (
        await session.exec(
            select(HabitLog).where(HabitLog.habit_id == habit_id, HabitLog.date == payload.date)
        )
    ).first()
    if existing is not None:
        existing.completed = payload.completed
        log = existing
    else:
        log = HabitLog(habit_id=habit_id, date=payload.date, completed=payload.completed)
        session.add(log)
    await session.commit()
    await session.refresh(log)
    return log


@router.get("/{habit_id}", response_model=Habit)
async def get_habit(habit_id: str, session: SessionDep):
    return await _get_habit_or_404(session, habit_id)


@router.delete("/{habit_id}", status_code=204)
async def delete_habit(habit_id: str, session: SessionDep):
    habit = await _get_habit_or_404(session, habit_id)
    await session.delete(habit)  # logs cascade via FK
    await session.commit()
