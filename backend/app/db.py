from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _is_memory(url: str) -> bool:
    return ":memory:" in url


def init_engine(db_url: str) -> AsyncEngine:
    """(Re)create the global engine. Called on app startup and by tests."""
    global _engine, _sessionmaker

    if db_url.startswith("sqlite") and not _is_memory(db_url):
        Path(db_url.split("///", 1)[-1]).parent.mkdir(parents=True, exist_ok=True)

    kwargs: dict = {"poolclass": StaticPool} if _is_memory(db_url) else {}
    engine = create_async_engine(db_url, **kwargs)

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _connection_record):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    _engine = engine
    _sessionmaker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    return engine


def engine_initialized() -> bool:
    return _engine is not None


def get_engine() -> AsyncEngine:
    if _engine is None:
        raise RuntimeError("Database engine not initialised; call init_engine() first")
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        raise RuntimeError("Database engine not initialised; call init_engine() first")
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session


async def init_db() -> None:
    from app import models  # noqa: F401  (registers tables on the metadata)

    async with get_engine().begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
