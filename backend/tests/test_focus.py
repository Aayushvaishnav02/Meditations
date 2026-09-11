from __future__ import annotations


def make_task(client, **overrides) -> dict:
    r = client.post("/api/tasks", json={"title": "Deep work target", **overrides})
    assert r.status_code == 201
    return r.json()


def make_session(client, **payload) -> dict:
    r = client.post("/api/focus/sessions", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_session_updates_task_actual_minutes(client):
    task = make_task(client)
    make_session(client, task_id=task["id"], duration_minutes=25)
    second = make_session(client, task_id=task["id"], duration_minutes=35, session_type="stopwatch")

    task_after = client.get(f"/api/tasks/{task['id']}").json()
    assert task_after["actual_minutes"] == 60

    r = client.delete(f"/api/focus/sessions/{second['id']}")
    assert r.status_code == 204
    assert client.get(f"/api/tasks/{task['id']}").json()["actual_minutes"] == 25


def test_sessions_filterable_by_task_and_date(client):
    task = make_task(client)
    make_session(client, task_id=task["id"], duration_minutes=25, created_at="2026-09-10T08:00:00Z")
    make_session(client, duration_minutes=50, created_at="2026-09-11T09:00:00Z")

    by_task = client.get("/api/focus/sessions", params={"task_id": task["id"]}).json()
    assert [s["duration_minutes"] for s in by_task] == [25]

    by_date = client.get("/api/focus/sessions", params={"on_date": "2026-09-11"}).json()
    assert len(by_date) == 1 and by_date[0]["duration_minutes"] == 50


def test_focus_summary(client):
    make_session(client, duration_minutes=25, created_at="2026-09-10T08:00:00Z")
    make_session(client, duration_minutes=35, created_at="2026-09-10T16:00:00Z")

    r = client.get("/api/focus/summary", params={"on_date": "2026-09-10"})
    body = r.json()
    assert body == {"date": "2026-09-10", "total_minutes": 60, "sessions": 2}


def test_unknown_task_rejected(client):
    r = client.post("/api/focus/sessions", json={"task_id": "ghost", "duration_minutes": 25})
    assert r.status_code == 404


def test_invalid_payloads(client):
    assert client.post("/api/focus/sessions", json={"duration_minutes": 0}).status_code == 422
    assert client.post("/api/focus/sessions", json={"duration_minutes": 25, "session_type": "nope"}).status_code == 422
    assert client.delete("/api/focus/sessions/ghost").status_code == 404
