from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import text

from app.routers.deps import SessionDep
from app.search import SearchHit, reindex, search, vec_available

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=list[SearchHit])
async def hybrid_search(
    session: SessionDep,
    q: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
):
    """Hybrid keyword (FTS5) + semantic (sqlite-vec) search over journals and rollups."""
    return await search(session, q, limit=limit)


@router.get("/status")
async def search_status(session: SessionDep):
    fts_docs = (await session.execute(text("SELECT count(*) FROM fts_entries"))).scalar()
    return {"fts": True, "semantic": vec_available(), "indexed_docs": fts_docs}


@router.post("/reindex")
async def rebuild_index(session: SessionDep):
    return await reindex(session)
