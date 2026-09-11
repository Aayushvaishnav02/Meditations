from __future__ import annotations

import datetime as dt

import pytest

import app.recurrence as recurrence
from app.util import utc_now


# --- rrule parsing ---
def test_parses_generated_subset():
    assert recurrence.parse_rrule("RRULE:FREQ=DAILY") == {"freq": "DAILY", "interval": 1, "byday": []}
    assert recurrence.parse_rrule("RRULE:FREQ=WEEKLY;BYDAY=MO,WE") == {"freq": "WEEKLY", "interval": 1, "byday": ["MO", "WE"]}
    assert recurrence.parse_rrule("RRULE:FREQ=WEEKLY;BYDAY=SA,SU")["byday"] == ["SA", "SU"]


def test_rejects_unsupported_rules():
    assert recurrence.parse_rrule("FREQ=MONTHLY;BYDAY=1MO") is None
    assert recurrence.parse_rrule("garbage") is None
    assert recurrence.parse_rrule("RRULE:FREQ=WEEKLY;INTERVAL=banana") is None


# --- next occurrence math ---
def test_daily_next():
    after = dt.datetime(2026, 9, 11, 7, 0)
    nxt = recurrence.next_occurrence("RRULE:FREQ=DAILY", after)
    assert nxt.date() == dt.date(2026, 9, 12)
    assert nxt.time() == dt.time(7, 0)

    nxt2 = recurrence.next_occurrence("RRULE:FREQ=DAILY;INTERVAL=3", after)
    assert nxt2.date() == dt.date(2026, 9, 14)


def test_weekly_multi_day_skips_ahead():
    # Friday Sep 11 2026 -> the NEXT matching weekday is Monday Sep 14
    friday = dt.datetime(2026, 9, 11, 17, 30)
    nxt = recurrence.next_occurrence("RRULE:FREQ=WEEKLY;BYDAY=MO,WE", friday)
    assert nxt.date() == dt.date(2026, 9, 14) and nxt.time() == dt.time(17, 30)

    # Monday -> next in MO,WE is Wednesday of the same week
    monday = dt.datetime(2026, 9, 7, 9, 0)
    assert recurrence.next_occurrence("RRULE:FREQ=WEEKLY;BYDAY=MO,WE", monday).date() == dt.date(2026, 9, 9)


def test_weekly_biweekly_interval():
    # week of Sep 7 -> next MO in "every 2 weeks" is Sep 21
    monday = dt.datetime(2026, 9, 7, 8, 0)
    nxt = recurrence.next_occurrence("RRULE:FREQ=WEEKLY;BYDAY=MO;INTERVAL=2", monday)
    assert nxt.date() == dt.date(2026, 9, 21)


def test_weekly_without_byday_uses_same_weekday():
    friday = dt.datetime(2026, 9, 11, 12, 0)
    nxt = recurrence.next_occurrence("RRULE:FREQ=WEEKLY", friday)
    assert nxt.date() == dt.date(2026, 9, 18)


def test_next_occurrence_is_strictly_after():
    after = dt.datetime(2026, 9, 11, 23, 59)
    assert recurrence.next_occurrence("RRULE:FREQ=DAILY", after).date() == dt.date(2026, 9, 12)


# --- integration: completing a recurring task spawns the next instance ---
def test_completing_recurring_task_regenerates(client):
    due = (utc_now() + __import__("datetime").timedelta(days=1)).isoformat()
    task = client.post(
        "/api/tasks",
        json={"title": "Gym", "due_date": due, "recurrence_rule": "RRULE:FREQ=DAILY"},
    ).json()

    r = client.patch(f"/api/tasks/{task['id']}", json={"status": "completed"})
    assert r.status_code == 200
    assert r.json()["status"] == "completed"  # finished instance stays finished

    tasks = client.get("/api/tasks").json()
    regenerated = [t for t in tasks if t["status"] == "todo" and t["title"] == "Gym"]
    assert len(regenerated) == 1, "next occurrence must appear"
    assert regenerated[0]["recurrence_rule"] == "RRULE:FREQ=DAILY"
    # next due is strictly after the completed one's due
    assert regenerated[0]["due_date"] > task["due_date"]


def test_completing_non_recurring_task_regenerates_nothing(client):
    task = client.post("/api/tasks", json={"title": "One-off"}).json()
    client.patch(f"/api/tasks/{task['id']}", json={"status": "completed"})
    tasks = client.get("/api/tasks").json()
    assert len([t for t in tasks if t["title"] == "One-off"]) == 1


def test_uncompleting_does_not_regenerate(client):
    task = client.post("/api/tasks", json={"title": "Chores", "recurrence_rule": "RRULE:FREQ=DAILY"}).json()
    client.patch(f"/api/tasks/{task['id']}", json={"status": "completed"})
    client.patch(f"/api/tasks/{task['id']}", json={"status": "todo"})
    tasks = client.get("/api/tasks").json()
    assert len([t for t in tasks if t["title"] == "Chores"]) == 2  # no extra spawns


# --- app preferences + score integration ---
def test_prefs_roundtrip_and_score_default(client):
    body = client.get("/api/settings/app").json()
    assert body == {"target_deep_work_hours": 4.0}

    client.post("/api/focus/sessions", json={"duration_minutes": 120})
    today = utc_now().date().isoformat()
    assert client.get(f"/api/scores/daily/{today}").json()["focus_score"] == 50  # 2h of 4h

    r = client.put("/api/settings/app", json={"target_deep_work_hours": 2.0})
    assert r.json()["target_deep_work_hours"] == 2.0
    assert client.get(f"/api/scores/daily/{today}").json()["focus_score"] == 100  # 2h of 2h

    assert client.put("/api/settings/app", json={"target_deep_work_hours": 0}).status_code == 422
    assert client.put("/api/settings/app", json={"target_deep_work_hours": 99}).status_code == 422


# --- AI connection test (mocked runner) ---
def test_ai_connection_test_ok(client, monkeypatch):
    import time as _time

    class FakeResult:
        output = "OK"

    class FakeAgent:
        def __init__(self, *a, **k): pass
        async def run(self, *a, **k): return FakeResult()

    monkeypatch.setattr("app.routers.preferences.Agent", FakeAgent)
    r = client.post("/api/settings/ai/test")
    body = r.json()
    assert body["ok"] is True and body["reply"] == "OK"
    assert isinstance(body["latency_ms"], int)


def test_ai_connection_test_failure_is_inline(client, monkeypatch):
    class FakeAgent:
        def __init__(self, *a, **k): pass
        async def run(self, *a, **k): raise RuntimeError("connection refused")

    monkeypatch.setattr("app.routers.preferences.Agent", FakeAgent)
    body = client.post("/api/settings/ai/test").json()
    assert body["ok"] is False
    assert "connection refused" in body["error"]
