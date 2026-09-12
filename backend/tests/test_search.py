from __future__ import annotations

import datetime as dt

import pytest

import app.search as search_mod
from app.util import monday_of, utc_now


@pytest.fixture(autouse=True)
def no_real_embeddings(monkeypatch):
    """Keep tests hermetic: never initialize the real fastembed model."""
    monkeypatch.setattr(search_mod, "embed_texts", lambda texts: None)


def write_journal(client, day: str, text: str) -> None:
    r = client.put(f"/api/journal/{day}", json={"raw_markdown": text})
    assert r.status_code == 200


def test_journal_save_is_automatically_indexed(client):
    day = (utc_now().date() - dt.timedelta(days=1)).isoformat()
    write_journal(client, day, "Started feeling burned out on the backend refactor today.")

    r = client.get("/api/search", params={"q": "burned out"})
    assert r.status_code == 200
    hits = r.json()
    assert any(h["doc_id"] == f"journal:{day}" for h in hits)
    assert "burned" in hits[0]["excerpt"]


def test_fts_finds_updates_and_delete_removes(client):
    day = "2026-09-05"
    write_journal(client, day, "Initial notes about the database layer.")
    assert client.get("/api/search", params={"q": "database layer"}).json()

    write_journal(client, day, "Completely different content now.")
    stale = client.get("/api/search", params={"q": "database layer"}).json()
    assert stale == [], "old content must be replaced on upsert"

    fresh = client.get("/api/search", params={"q": "different content"}).json()
    assert any(h["doc_id"] == f"journal:{day}" for h in fresh)

    assert client.delete(f"/api/journal/{day}").status_code == 204
    assert client.get("/api/search", params={"q": "different content"}).json() == []


def test_phrase_query_and_multiple_kinds(client, monkeypatch):
    import app.agents as agents

    async def fake_runner(deps, model=None, system_prompt=None, on_usage=None):
        return agents.WeeklyReviewOutput(wins="Refactored the parser core", misses="", carried_action_items="")

    monkeypatch.setattr(agents, "run_weekly_review", fake_runner)

    week = monday_of(utc_now().date())
    write_journal(client, week.isoformat(), "worked on the parser all day")
    assert client.post("/api/agents/rollup/weekly", params={"week_start": week.isoformat()}).status_code == 200

    # journal + weekly both searchable
    hits = client.get("/api/search", params={"q": "parser"}).json()
    kinds = {h["kind"] for h in hits}
    assert kinds == {"journal", "weekly"}
    assert any(h["title"].startswith("Week of") for h in hits)


def test_search_status_and_reindex(client):
    day = (utc_now().date() - dt.timedelta(days=2)).isoformat()
    write_journal(client, day, "Indexed me.")

    status = client.get("/api/search/status").json()
    assert status["fts"] is True
    assert "semantic" in status  # may be True/False depending on extension availability
    assert status["indexed_docs"] >= 1

    r = client.post("/api/search/reindex")
    assert r.status_code == 200
    assert r.json()["indexed"] >= 1


def test_empty_and_garbage_queries(client):
    assert client.get("/api/search", params={"q": "   "}).json() == []
    # FTS special characters must not crash the query
    hits = client.get("/api/search", params={"q": "NEAR/2 (' ( OR NOT"}).json()
    assert isinstance(hits, list)


def test_reciprocal_rank_fusion_merges_sources(client, monkeypatch):
    """With the extension available, stubbed vectors must fuse with FTS via RRF."""
    if not search_mod.vec_available():
        pytest.skip("sqlite-vec extension not available in this environment")

    # deterministic stub: all "burned" texts share one vector, others get another
    def stub_embed(texts):
        out = []
        for t in texts:
            vec = [0.0] * search_mod.EMBED_DIM
            vec[0 if "burned" in t.lower() else 1] = 1.0
            out.append(vec)
        return out

    monkeypatch.setattr(search_mod, "embed_texts", stub_embed)

    a = (utc_now().date() - dt.timedelta(days=1)).isoformat()
    b = (utc_now().date() - dt.timedelta(days=2)).isoformat()
    write_journal(client, a, "burned out on the backend refactor")
    write_journal(client, b, "great day shipping features")

    hits = client.get("/api/search", params={"q": "burned out refactor"}).json()
    assert hits, "hybrid search must return results"
    top = hits[0]
    assert top["doc_id"] == f"journal:{a}"
    # FTS matches a; the stub query vector is identical to a's -> semantic too
    assert set(top["sources"]) == {"fts", "semantic"}

    # doc b shares nothing with the query: only FTS could match it, and it doesn't
    assert all(h["doc_id"] != f"journal:{b}" for h in hits)
