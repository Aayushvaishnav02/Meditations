from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.config import get_app_settings
from app.routers import ai_settings, focus, habits, lists, scores, tasks


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not db.engine_initialized():  # tests pre-initialise an in-memory engine
        settings = get_app_settings()
        db.init_engine(f"sqlite+aiosqlite:///{settings.journal_db_path}")
    await db.init_db()
    yield
    await db.dispose_engine()


app = FastAPI(title="Journal API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost", "http://tauri.localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (lists.router, tasks.router, focus.router, habits.router, scores.router, ai_settings.router):
    app.include_router(router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
