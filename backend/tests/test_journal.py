from __future__ import annotations


def test_journal_upsert_and_get(client):
    r = client.put("/api/journal/2026-09-10", json={"raw_markdown": "# Day one\nWrote code."})
    assert r.status_code == 200

    r = client.get("/api/journal/2026-09-10")
    assert r.status_code == 200
    assert r.json()["raw_markdown"] == "# Day one\nWrote code."
    assert r.json()["mood"] is None

    # second PUT updates the same row (date is the PK)
    r = client.put("/api/journal/2026-09-10", json={"raw_markdown": "Revised.", "mood": 4, "energy": 3})
    assert r.json()["mood"] == 4 and r.json()["energy"] == 3

    entries = client.get("/api/journal/2026-09-10")
    assert entries.status_code == 200


def test_journal_missing_day_404(client):
    assert client.get("/api/journal/2026-09-09").status_code == 404


def test_journal_delete(client):
    client.put("/api/journal/2026-09-10", json={"raw_markdown": "x"})
    assert client.delete("/api/journal/2026-09-10").status_code == 204
    assert client.get("/api/journal/2026-09-10").status_code == 404


def test_journal_mood_energy_validation(client):
    assert client.put("/api/journal/2026-09-10", json={"raw_markdown": "x", "mood": 0}).status_code == 422
    assert client.put("/api/journal/2026-09-10", json={"raw_markdown": "x", "energy": 6}).status_code == 422
    assert client.put("/api/journal/2026-09-10", json={"raw_markdown": "x", "mood": 5, "energy": 1}).status_code == 200


def test_journal_snapshots_telemetry_on_save(client):
    from app.util import utc_now

    day = utc_now().date().isoformat()
    # a task completed today + a focus session today
    task = client.post("/api/tasks", json={"title": "Ship it"}).json()
    client.patch(f"/api/tasks/{task['id']}", json={"status": "completed"})
    client.post("/api/focus/sessions", json={"duration_minutes": 90})

    entry = client.put(f"/api/journal/{day}", json={"raw_markdown": "busy day"}).json()
    assert entry["tasks_done"] == 1
    assert entry["tasks_planned"] == 1  # undated task completed today counts as planned
    assert entry["hours_deep_work"] == 1.5

    activity = client.get(f"/api/journal/{day}/activity").json()
    assert [t["title"] for t in activity["tasks_done"]] == ["Ship it"]
    assert activity["focus_minutes"] == 90 and activity["focus_sessions"] == 1
    assert activity["habits"] == []  # no habits configured

    # habit checklist appears once habits exist
    habit = client.post("/api/habits", json={"name": "Read"}).json()
    client.put(f"/api/habits/{habit['id']}/logs", json={"date": day, "completed": True})
    client.post("/api/habits", json={"name": "Workout"})  # not logged
    activity = client.get(f"/api/journal/{day}/activity").json()
    assert activity["habits"] == [
        {"id": habit["id"], "name": "Read", "completed": True},
        {"id": activity["habits"][1]["id"], "name": "Workout", "completed": False},
    ]


def test_journal_snapshot_survives_later_edits(client):
    """tasks_done reflects the moment of saving; later completion is picked up on next save."""
    from app.util import utc_now

    day = utc_now().date().isoformat()
    task = client.post("/api/tasks", json={"title": "Later"}).json()
    client.put(f"/api/journal/{day}", json={"raw_markdown": "empty"})
    assert client.get(f"/api/journal/{day}").json()["tasks_done"] == 0

    client.patch(f"/api/tasks/{task['id']}", json={"status": "completed"})
    client.put(f"/api/journal/{day}", json={"raw_markdown": "updated"})
    assert client.get(f"/api/journal/{day}").json()["tasks_done"] == 1
