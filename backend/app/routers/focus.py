from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException
from sqlmodel import func, select

from app.models import FocusSession, Task
from app.routers.deps import SessionDep
from app.schemas import FocusSessionCreate, FocusSummary
from app.util import day_bounds, utc_now

router = APIRouter(prefix="/api/focus", tags=["focus"])


@router.get("/sessions", response_model=list[FocusSession])
async def list_sessions(session: SessionDep, task_id: str | None = None, on_date: date | None = None):
    q = select(FocusSession)
    if task_id is not None:
        q = q.where(FocusSession.task_id == task_id)
    if on_date is not None:
        start, end = day_bounds(on_date)
        q = q.where(FocusSession.created_at >= start, FocusSession.created_at < end)
    return (await session.exec(q.order_by(FocusSession.created_at.desc()))).all()


@router.post("/sessions", response_model=FocusSession, status_code=201)
async def create_session(payload: FocusSessionCreate, session: SessionDep):
    task: Task | None = None
    if payload.task_id is not None:
        task = await session.get(Task, payload.task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")

    focus_session = FocusSession(**payload.model_dump(exclude_unset=True))
    session.add(focus_session)
    if task is not None:
        task.actual_minutes += payload.duration_minutes
        task.updated_at = utc_now()
    await session.commit()
    await session.refresh(focus_session)
    return focus_session


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, session: SessionDep):
    focus_session = await session.get(FocusSession, session_id)
    if focus_session is None:
        raise HTTPException(status_code=404, detail="Focus session not found")
    if focus_session.task_id is not None:
        task = await session.get(Task, focus_session.task_id)
        if task is not None:
            task.actual_minutes = max(0, task.actual_minutes - focus_session.duration_minutes)
            task.updated_at = utc_now()
    await session.delete(focus_session)
    await session.commit()


@router.get("/summary", response_model=FocusSummary)
async def focus_summary(session: SessionDep, on_date: date):
    start, end = day_bounds(on_date)
    conditions = (FocusSession.created_at >= start, FocusSession.created_at < end)
    total_minutes = (
        await session.exec(
            select(func.coalesce(func.sum(FocusSession.duration_minutes), 0)).where(*conditions)
        )
    ).one()
    sessions = (
        await session.exec(select(func.count(FocusSession.id)).where(*conditions))
    ).one()
    return FocusSummary(date=on_date, total_minutes=total_minutes, sessions=sessions)
