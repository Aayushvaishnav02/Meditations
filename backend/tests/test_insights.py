from __future__ import annotations

import datetime as dt

import pytest

from app.util import utc_now


def seed_journal(client, day: str, text: str, mood: int | None = None) -> None:
    r = client.put(f"/api/journal/{day}", json={"raw_markdown": text, "mood": mood})
    assert r.status_code == 200


def test_insights_series_and_totals(client):
    today = utc_now().date()
    yesterday = today - dt.timedelta(days=1)

    # today: 1/1 task done, 1h focus + a journaled mood; yesterday: journal only
    task = client.post("/api/tasks", json={"title": "Done today", "due_date": f"{today}T12:00:00"}).json()
    client.patch(f"/api/tasks/{task['id']}", json={"status": "completed"})
    client.post("/api/focus/sessions", json={"duration_minutes": 60})
    seed_journal(client, today.isoformat(), "productive day", mood=5)
    seed_journal(client, yesterday.isoformat(), "quiet day")

    r = client.get("/api/insights", params={"days": 14})
    assert r.status_code == 200
    body = r.json()

    assert body["days"] == 14
    assert len(body["series"]) == 14

    t = next(s for s in body["series"] if s["date"] == today.isoformat())
    assert t["tasks_completed"] == 1 and t["tasks_planned"] == 1
    assert t["deep_work_hours"] == 1.0
    assert t["mood"] == 5

    y = next(s for s in body["series"] if s["date"] == yesterday.isoformat())
    assert y["tasks_completed"] == 0 and y["mood"] is None

    assert body["totals"]["tasks_done"] == 1
    assert body["totals"]["total_focus_hours"] == 1.0
    assert body["totals"]["completion_rate"] == pytest.approx(1.0)
    assert body["totals"]["target_deep_work_hours"] == 4.0


def test_insights_journaling_streaks(client):
    today = utc_now().date()
    # journal on a consecutive run ending yesterday: 3-day streak (today not yet written)
    for offset in (1, 2, 3):
        seed_journal(client, (today - dt.timedelta(days=offset)).isoformat(), f"day {-offset}")
    # plus an older isolated entry (best-streak history)
    seed_journal(client, (today - dt.timedelta(days=10)).isoformat(), "isolated")

    body = client.get("/api/insights", params={"days": 30}).json()
    assert body["journaling_streak"] == 3
    assert body["journaling_best"] == 3

    # writing today extends the current streak to 4
    seed_journal(client, today.isoformat(), "today too")
    body = client.get("/api/insights", params={"days": 30}).json()
    assert body["journaling_streak"] == 4


def test_insights_habit_streaks_and_rate(client):
    habit = client.post("/api/habits", json={"name": "Read"}).json()
    today = utc_now().date()
    for offset in (0, 1, 2):  # today + 2 back
        client.put(f"/api/habits/{habit['id']}/logs", json={"date": (today - dt.timedelta(days=offset)).isoformat(), "completed": True})

    body = client.get("/api/insights", params={"days": 30}).json()
    h = next(h for h in body["habits"] if h["id"] == habit["id"])
    assert h["current_streak"] == 3
    assert h["rate_30"] == pytest.approx(3 / 30)


def test_insights_includes_rollups(client, monkeypatch):
    import app.agents as agents

    async def fake_weekly(deps, model=None, system_prompt=None, on_usage=None):
        return agents.WeeklyReviewOutput(wins="w", misses="m", carried_action_items="c")

    monkeypatch.setattr(agents, "run_weekly_review", fake_weekly)

    week = __import__("app.util", fromlist=["monday_of"]).monday_of(utc_now().date())
    seed_journal(client, week.isoformat(), "week entry")
    assert client.post("/api/agents/rollup/weekly", params={"week_start": week.isoformat()}).status_code == 200

    body = client.get("/api/insights").json()
    assert len(body["weekly"]) == 1
    assert body["weekly"][0]["week_start"] == week.isoformat()
    assert body["monthly"] == []


def test_insights_days_param_validated(client):
    assert client.get("/api/insights", params={"days": 7}).status_code == 422
    assert client.get("/api/insights", params={"days": 200}).status_code == 422
    assert client.get("/api/insights", params={"days": 90}).status_code == 200
