from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text
from sqlmodel import func, select

from app.models import Task, TaskList
from app.recurrence import next_occurrence
from app.routers.deps import SessionDep
from app.schemas import TaskCreate, TaskReorder, TaskStatus, TaskUpdate
from app.util import new_id, normalize_dt, utc_now

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


async def _get_task_or_404(session: SessionDep, task_id: str) -> Task:
    task = await session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _tag_condition(tag: str):
    return text(
        "EXISTS (SELECT 1 FROM json_each(tasks.tags) WHERE json_each.value = :tag_value)"
    ).bindparams(tag_value=tag)


async def _next_order_index(session: SessionDep, list_id: str | None, parent_id: str | None) -> float:
    q = select(func.max(Task.order_index)).where(
        Task.parent_id == parent_id if parent_id else Task.parent_id.is_(None),
        Task.list_id == list_id if list_id else Task.list_id.is_(None),
    )
    current = (await session.exec(q)).one()
    return (current or 0.0) + 1000.0


async def _ensure_no_cycle(session: SessionDep, task_id: str, new_parent_id: str) -> None:
    if new_parent_id == task_id:
        raise HTTPException(status_code=400, detail="Task cannot be its own parent")
    seen: set[str] = set()
    cursor: str | None = new_parent_id
    while cursor is not None:
        if cursor == task_id:
            raise HTTPException(status_code=400, detail="Cannot move a task under its own descendant")
        if cursor in seen:  # defensive against pre-existing corruption
            break
        seen.add(cursor)
        parent = await session.get(Task, cursor)
        cursor = parent.parent_id if parent else None


@router.get("", response_model=list[Task])
async def list_tasks(
    session: SessionDep,
    list_id: str | None = None,
    parent_id: str | None = None,
    top_level: bool = False,
    status: TaskStatus | None = None,
    tag: str | None = None,
    due_before: datetime | None = None,
    due_after: datetime | None = None,
    overdue: bool = False,
):
    q = select(Task)
    if list_id is not None:
        q = q.where(Task.list_id == list_id)
    if parent_id is not None:
        q = q.where(Task.parent_id == parent_id)
    if top_level:
        q = q.where(Task.parent_id.is_(None))
    if status is not None:
        q = q.where(Task.status == status)
    if tag is not None:
        q = q.where(_tag_condition(tag))
    if due_before is not None:
        q = q.where(Task.due_date.is_not(None), Task.due_date < normalize_dt(due_before))
    if due_after is not None:
        q = q.where(Task.due_date.is_not(None), Task.due_date >= normalize_dt(due_after))
    if overdue:
        q = q.where(
            Task.due_date.is_not(None),
            Task.due_date < utc_now(),
            Task.status.in_(["todo", "in_progress"]),
        )
    q = q.order_by(Task.order_index, Task.created_at)
    return (await session.exec(q)).all()


@router.post("", response_model=Task, status_code=201)
async def create_task(payload: TaskCreate, session: SessionDep):
    if payload.list_id is not None and await session.get(TaskList, payload.list_id) is None:
        raise HTTPException(status_code=404, detail="List not found")
    if payload.parent_id is not None and await session.get(Task, payload.parent_id) is None:
        raise HTTPException(status_code=404, detail="Parent task not found")

    data = payload.model_dump()
    data["order_index"] = await _next_order_index(session, payload.list_id, payload.parent_id)
    task = Task(**data)
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return task


@router.get("/{task_id}", response_model=Task)
async def get_task(task_id: str, session: SessionDep):
    return await _get_task_or_404(session, task_id)


@router.get("/{task_id}/children", response_model=list[Task])
async def get_task_children(task_id: str, session: SessionDep):
    await _get_task_or_404(session, task_id)
    q = select(Task).where(Task.parent_id == task_id).order_by(Task.order_index, Task.created_at)
    return (await session.exec(q)).all()


@router.patch("/{task_id}", response_model=Task)
async def update_task(task_id: str, payload: TaskUpdate, session: SessionDep):
    task = await _get_task_or_404(session, task_id)
    changes = payload.model_dump(exclude_unset=True)

    if changes.get("list_id") is not None and await session.get(TaskList, changes["list_id"]) is None:
        raise HTTPException(status_code=404, detail="List not found")
    if changes.get("parent_id") is not None:
        if await session.get(Task, changes["parent_id"]) is None:
            raise HTTPException(status_code=404, detail="Parent task not found")
        await _ensure_no_cycle(session, task_id, changes["parent_id"])

    new_status = changes.get("status")
    completing = new_status == "completed" and task.status != "completed"
    if new_status is not None:
        if completing:
            task.completed_at = utc_now()
        elif new_status != "completed":
            task.completed_at = None

    for key, value in changes.items():
        setattr(task, key, value)
    task.updated_at = utc_now()

    # recurring task completed -> spawn its next occurrence (TickTick-style);
    # the finished instance stays completed so telemetry/history is preserved
    if completing and task.recurrence_rule:
        base = task.due_date or task.completed_at
        next_due = next_occurrence(task.recurrence_rule, base or utc_now())
        # un-complete/re-complete cycles must not stack duplicate instances
        duplicate = (
            await session.exec(
                select(Task).where(
                    Task.title == task.title,
                    Task.recurrence_rule == task.recurrence_rule,
                    Task.status.in_(["todo", "in_progress"]),
                    Task.due_date == next_due,
                    Task.id != task.id,
                )
            )
        ).first() if next_due is not None else None
        if next_due is not None and duplicate is None:
            session.add(
                Task(
                    id=new_id(),
                    list_id=task.list_id,
                    parent_id=task.parent_id,
                    title=task.title,
                    description=task.description,
                    priority=task.priority,
                    due_date=next_due,
                    estimated_minutes=task.estimated_minutes,
                    recurrence_rule=task.recurrence_rule,
                    tags=task.tags,
                    order_index=task.order_index + 1000.0,
                )
            )

    await session.commit()
    await session.refresh(task)
    return task


@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: str, session: SessionDep):
    task = await _get_task_or_404(session, task_id)
    await session.delete(task)  # subtasks cascade via FK
    await session.commit()


@router.post("/reorder", response_model=list[Task])
async def reorder_tasks(payload: TaskReorder, session: SessionDep):
    tasks: list[Task] = []
    for index, task_id in enumerate(payload.ordered_ids):
        task = await _get_task_or_404(session, task_id)
        task.order_index = float(index) * 1000.0
        task.updated_at = utc_now()
        tasks.append(task)
    await session.commit()
    for task in tasks:
        await session.refresh(task)
    return tasks
