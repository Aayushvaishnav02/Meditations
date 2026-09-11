from __future__ import annotations

import pytest

from app.util import utc_now


def make_habit(client, name="Read", **overrides) -> dict:
    r = client.post("/api/habits", json={"name": name, **overrides})
    assert r.status_code == 201
    return r.json()


def test_habit_log_upsert(client):
    habit = make_habit(client)
    day = "2026-09-10"

    r = client.put(f"/api/habits/{habit['id']}/logs", json={"date": day, "completed": True})
    assert r.status_code == 200 and r.json()["completed"] is True

    r = client.put(f"/api/habits/{habit['id']}/logs", json={"date": day, "completed": False})
    assert r.status_code == 200 and r.json()["completed"] is False

    logs = client.get("/api/habits/logs", params={"on_date": day}).json()
    assert len(logs) == 1, "upsert must not create duplicates"


def test_delete_habit_cascades_logs(client):
    habit = make_habit(client)
    client.put(f"/api/habits/{habit['id']}/logs", json={"date": "2026-09-10"})

    assert client.delete(f"/api/habits/{habit['id']}").status_code == 204
    assert client.get("/api/habits/logs").json() == []


def test_log_range_query(client):
    habit = make_habit(client)
    for day in ("2026-09-08", "2026-09-09", "2026-09-10"):
        client.put(f"/api/habits/{habit['id']}/logs", json={"date": day})

    r = client.get(
        "/api/habits/logs", params={"habit_id": habit["id"], "from_date": "2026-09-09", "to_date": "2026-09-09"}
    ).json()
    assert [log["date"] for log in r] == ["2026-09-09"]


def test_unknown_habit_log_404(client):
    assert client.put("/api/habits/ghost/logs", json={"date": "2026-09-10"}).status_code == 404


def test_empty_day_scores_neutral_habits(client):
    r = client.get("/api/scores/daily/2026-09-10")
    body = r.json()
    assert body["task_score"] == 0
    assert body["focus_score"] == 0
    assert body["habit_score"] == 100  # no habits configured -> neutral
    assert body["weighted_score"] == pytest.approx(15)
    assert body["final_score"] == pytest.approx(15)
    assert body["persisted"] is False
    assert body["metrics"] == {
        "tasks_completed": 0,
        "tasks_planned": 0,
        "deep_work_hours": 0.0,
        "habits_completed": 0,
        "habits_scheduled": 0,
    }


def test_daily_score_from_live_telemetry(client):
    today = utc_now().date()
    day = today.isoformat()

    # Task due today, completed today -> planned and done.
    r = client.post("/api/tasks", json={"title": "Ship", "due_date": f"{day}T12:00:00Z"})
    task = r.json()
    client.patch(f"/api/tasks/{task['id']}", json={"status": "completed"})

    # 60 focus minutes vs default 4h target -> 25/100.
    client.post("/api/focus/sessions", json={"duration_minutes": 60})

    # Daily habit, completed today -> 100.
    habit = make_habit(client, "Read")
    client.put(f"/api/habits/{habit['id']}/logs", json={"date": day, "completed": True})

    body = client.get(f"/api/scores/daily/{day}").json()
    assert body["task_score"] == 100
    assert body["focus_score"] == 25
    assert body["habit_score"] == 100
    expected = 0.40 * 100 + 0.35 * 25 + 0.15 * 100
    assert body["final_score"] == pytest.approx(expected)

    metrics = body["metrics"]
    assert metrics["tasks_completed"] == 1 and metrics["tasks_planned"] == 1
    assert metrics["deep_work_hours"] == 1.0
    assert metrics["habits_completed"] == 1 and metrics["habits_scheduled"] == 1


def test_daily_score_respects_target_hours_param(client):
    today = utc_now().date()
    client.post("/api/focus/sessions", json={"duration_minutes": 120})
    body = client.get(f"/api/scores/daily/{today}", params={"target_hours": 2}).json()
    assert body["focus_score"] == 100


def test_overdue_task_counts_as_planned(client):
    yesterday = "2026-09-09"
    today = "2026-09-10"
    # Created backdated via explicit due date; still open on `today`.
    client.post("/api/tasks", json={"title": "Overdue", "due_date": f"{yesterday}T09:00:00Z"})

    body = client.get(f"/api/scores/daily/{today}").json()
    assert body["metrics"]["tasks_planned"] == 1
    assert body["metrics"]["tasks_completed"] == 0
