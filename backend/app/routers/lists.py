from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlmodel import select

from app.models import TaskList
from app.routers.deps import SessionDep
from app.schemas import ListCreate, ListUpdate

router = APIRouter(prefix="/api/lists", tags=["lists"])


async def _get_list_or_404(session: SessionDep, list_id: str) -> TaskList:
    obj = await session.get(TaskList, list_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="List not found")
    return obj


@router.get("", response_model=list[TaskList])
async def list_lists(session: SessionDep):
    return (
        await session.exec(select(TaskList).order_by(TaskList.created_at, TaskList.id))
    ).all()


@router.post("", response_model=TaskList, status_code=201)
async def create_list(payload: ListCreate, session: SessionDep):
    obj = TaskList(**payload.model_dump())
    session.add(obj)
    await session.commit()
    await session.refresh(obj)
    return obj


@router.get("/{list_id}", response_model=TaskList)
async def get_list(list_id: str, session: SessionDep):
    return await _get_list_or_404(session, list_id)


@router.patch("/{list_id}", response_model=TaskList)
async def update_list(list_id: str, payload: ListUpdate, session: SessionDep):
    obj = await _get_list_or_404(session, list_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    session.add(obj)
    await session.commit()
    await session.refresh(obj)
    return obj


@router.delete("/{list_id}", status_code=204)
async def delete_list(list_id: str, session: SessionDep):
    obj = await _get_list_or_404(session, list_id)
    await session.delete(obj)
    await session.commit()
