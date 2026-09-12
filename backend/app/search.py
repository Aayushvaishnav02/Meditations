"""Hybrid search over journals and rollups (plan §6.3.5).

- FTS5 (`fts_entries`) indexes all kinds: journal / weekly / monthly.
- sqlite-vec (`vec_entries`) holds bge-small-en-v1.5 embeddings (384 dims) for
  semantic recall; built with fastembed, fully local.
- Results fuse via reciprocal-rank fusion. Semantic search is strictly
  optional: if the extension or the embedding model is unavailable, FTS alone
  answers queries.
"""

from __future__ import annotations

import datetime as dt

import sqlite_vec
from sqlalchemy import text
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models import JournalEntry, MonthlySummary, WeeklySummary

EMBED_DIM = 384  # bge-small-en-v1.5
MAX_EMBED_CHARS = 2000  # bge-small context is ~512 tokens
# fastembed bge vectors are unit-normalized -> L2 distance in [0, 2];
# distance <= 1.0 means cosine similarity >= 0.5 (roughly "same topic").
# Without a cutoff, tiny indexes always "match" every doc.
SEMANTIC_MAX_DISTANCE = 1.0

FTS_DDL = (
    "CREATE VIRTUAL TABLE IF NOT EXISTS fts_entries USING fts5("
    "content, kind UNINDEXED, doc_id UNINDEXED)"
)
VEC_DDL = (
    "CREATE VIRTUAL TABLE IF NOT EXISTS vec_entries USING vec0("
    "doc_id TEXT PRIMARY KEY, embedding float[384])"
)

_vec_ready = False
_model = None


def vec_available() -> bool:
    return _vec_ready


async def init_search(conn) -> None:
    """Create the FTS/vector tables. Called from db.init_db."""
    global _vec_ready
    await conn.execute(text(FTS_DDL))
    try:
        await conn.execute(text("SELECT vec_version()"))
        await conn.execute(text(VEC_DDL))
        _vec_ready = True
    except Exception:  # noqa: BLE001 — degrade to FTS-only, always
        _vec_ready = False


def _embed_model():
    global _model
    if _model is not None:
        return _model
    try:
        from fastembed import TextEmbedding

        _model = TextEmbedding("BAAI/bge-small-en-v1.5")
        return _model
    except Exception:  # noqa: BLE001 — offline / model unavailable
        return None


def embed_texts(texts: list[str]) -> list[list[float]] | None:
    model = _embed_model()
    if model is None:
        return None
    truncated = [t[:MAX_EMBED_CHARS] for t in texts]
    return [vec.tolist() for vec in model.embed(truncated)]


def _serialize(vec: list[float]) -> bytes:
    return sqlite_vec.serialize_float32(vec)


def _fts_query(q: str) -> str:
    """Build a lenient OR-query; a quoted input becomes a phrase query.

    Tokens are stripped to word characters and FTS5 operator keywords are
    dropped so arbitrary user input can never crash the parser.
    """
    q = q.strip()
    if q.startswith('"') and q.endswith('"') and len(q) > 2:
        inner = q[1:-1].replace('"', " ")
        return f'"{inner}"'
    words: list[str] = []
    for raw in q.replace('"', " ").split():
        word = "".join(ch for ch in raw if ch.isalnum() or ch == "_")
        if word and word.upper() not in {"AND", "OR", "NOT", "NEAR"}:
            words.append(word)
    return " OR ".join(words)


def journal_doc_id(day: dt.date) -> str:
    return f"journal:{day.isoformat()}"


async def _execute(session: AsyncSession, sql: str, params: dict | None = None):
    return await session.execute(text(sql), params or {})


async def index_document(session: AsyncSession, doc_id: str, kind: str, content: str) -> None:
    """Upsert one document into FTS (always) and the vector index (when possible)."""
    await remove_document(session, doc_id)
    await _execute(session, "INSERT INTO fts_entries(content, kind, doc_id) VALUES (:c, :k, :d)", {"c": content, "k": kind, "d": doc_id})
    if _vec_ready:
        vec = embed_texts([content])
        if vec is not None:
            await _execute(session, "INSERT INTO vec_entries(doc_id, embedding) VALUES (:d, :e)", {"d": doc_id, "e": _serialize(vec[0])})


async def remove_document(session: AsyncSession, doc_id: str) -> None:
    await _execute(session, "DELETE FROM fts_entries WHERE doc_id = :d", {"d": doc_id})
    if _vec_ready:
        await _execute(session, "DELETE FROM vec_entries WHERE doc_id = :d", {"d": doc_id})


class SearchHit(SQLModel):
    doc_id: str
    kind: str
    title: str
    date: str
    excerpt: str
    score: float
    sources: list[str]


def _doc_meta(doc_id: str) -> tuple[str, str, str]:
    kind, _, key = doc_id.partition(":")
    if kind == "journal":
        return key, key, kind
    if kind == "weekly":
        return f"Week of {key}", key, kind
    return f"Monthly review {key}", key, kind


async def content_for(session: AsyncSession, doc_id: str) -> str:
    """Full stored markdown for a document (used to build Q&A context)."""
    kind, _, key = doc_id.partition(":")
    if kind == "journal":
        entry = await session.get(JournalEntry, dt.date.fromisoformat(key))
        return entry.raw_markdown if entry else ""
    if kind == "weekly":
        week = await session.get(WeeklySummary, dt.date.fromisoformat(key))
        return "\n".join(filter(None, [week.wins, week.misses, week.carried_action_items])) if week else ""
    month = await session.get(MonthlySummary, key)
    return month.narrative if month else ""


async def reindex(session: AsyncSession) -> dict:
    """Full rebuild of FTS + vectors from the source tables."""
    count = 0
    for entry in (await session.exec(select(JournalEntry))).all():
        await index_document(session, journal_doc_id(entry.date), "journal", entry.raw_markdown)
        count += 1
    for week in (await session.exec(select(WeeklySummary))).all():
        content = "\n".join(filter(None, [week.wins, week.misses, week.carried_action_items]))
        await index_document(session, f"weekly:{week.week_start.isoformat()}", "weekly", content)
        count += 1
    for month in (await session.exec(select(MonthlySummary))).all():
        await index_document(session, f"monthly:{month.month}", "monthly", month.narrative)
        count += 1
    await session.commit()
    return {"indexed": count, "semantic": bool(_vec_ready and _embed_model())}


async def backfill_missing(session: AsyncSession) -> int:
    """Index source documents missing from FTS (e.g. written before the search
    feature existed). Idempotent; runs at startup. Vector backfill for docs
    indexed before the embedding model was available happens via reindex."""
    count = 0
    sources: list[tuple[str, str, str]] = [
        (journal_doc_id(e.date), "journal", e.raw_markdown)
        for e in (await session.exec(select(JournalEntry))).all()
    ]
    sources += [
        (f"weekly:{w.week_start.isoformat()}", "weekly", "\n".join(filter(None, [w.wins, w.misses, w.carried_action_items])))
        for w in (await session.exec(select(WeeklySummary))).all()
    ]
    sources += [(f"monthly:{m.month}", "monthly", m.narrative) for m in (await session.exec(select(MonthlySummary))).all()]

    for doc_id, kind, content in sources:
        exists = (await _execute(session, "SELECT 1 FROM fts_entries WHERE doc_id = :d LIMIT 1", {"d": doc_id})).first()
        if exists is None:
            await index_document(session, doc_id, kind, content)
            count += 1
    if count:
        await session.commit()
    return count


async def search(session: AsyncSession, q: str, limit: int = 20) -> list[SearchHit]:
    if not q.strip():
        return []
    match_expr = _fts_query(q)
    if not match_expr:
        return []

    fts_rows = (
        await _execute(
            session,
            "SELECT doc_id, snippet(fts_entries, 0, '', '', '…', 16) AS snip"
            " FROM fts_entries WHERE fts_entries MATCH :q ORDER BY bm25(fts_entries) LIMIT :n",
            {"q": match_expr, "n": limit},
        )
    ).all()
    fts_hits: dict[str, tuple[int, str]] = {}
    for rank, (doc_id, snip) in enumerate(fts_rows):
        fts_hits[doc_id] = (rank, snip)

    sem_hits: dict[str, int] = {}
    if _vec_ready:
        vec = embed_texts([q])
        if vec is not None:
            rows = (
                await _execute(
                    session,
                    "SELECT doc_id, distance FROM vec_entries WHERE embedding MATCH :e AND k = :k",
                    {"e": _serialize(vec[0]), "k": limit},
                )
            ).all()
            for rank, (doc_id, distance) in enumerate(
                sorted(rows, key=lambda r: r[1])
            ):
                if distance <= SEMANTIC_MAX_DISTANCE:
                    sem_hits[doc_id] = rank

    # reciprocal-rank fusion
    fused: dict[str, float] = {}
    for doc_id, (rank, _snip) in fts_hits.items():
        fused[doc_id] = fused.get(doc_id, 0.0) + 1.0 / (60 + rank)
    for doc_id, rank in sem_hits.items():
        fused[doc_id] = fused.get(doc_id, 0.0) + 1.0 / (60 + rank)
    ordered = sorted(fused.items(), key=lambda kv: kv[1], reverse=True)[:limit]

    hits: list[SearchHit] = []
    for doc_id, score in ordered:
        snip = fts_hits.get(doc_id, (None, ""))[1]
        sources = [s for s, m in (("fts", fts_hits), ("semantic", sem_hits)) if doc_id in m]
        if not snip:
            content = await content_for(session, doc_id)
            snip = content[:240] + ("…" if len(content) > 240 else "")
        title, date, kind = _doc_meta(doc_id)
        hits.append(
            SearchHit(doc_id=doc_id, kind=kind, title=title, date=date, excerpt=snip, score=round(score, 5), sources=sources)
        )
    return hits
