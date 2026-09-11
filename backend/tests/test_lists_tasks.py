from __future__ import annotations

import pytest


def make_list(client, name="Inbox") -> dict:
    r = client.post("/api/lists", json={"name": name})
    assert r.status_code == 201
    return r.json()


def make_task(client, **overrides) -> dict:
    payload = {"title": "Buy milk", **overrides}
    r = client.post("/api/tasks", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def test_list_crud(client):
    created = make_list(client, "Work")
    assert created["color"] == "#64748b"

    r = client.get(f"/api/lists/{created['id']}")
    assert r.status_code == 200

    r = client.patch(f"/api/lists/{created['id']}", json={"is_favorite": True, "color": "#ff0000"})
    assert r.json()["is_favorite"] is True and r.json()["color"] == "#ff0000"

    r = client.delete(f"/api/lists/{created['id']}")
    assert r.status_code == 204
    assert client.get(f"/api/lists/{created['id']}").status_code == 404
    assert client.patch("/api/lists/nope", json={"name": "x"}).status_code == 404


def test_task_defaults_and_ordering(client):
    lst = make_list(client)
    first = make_task(client, list_id=lst["id"])
    second = make_task(client, list_id=lst["id"], title="Second")

    assert first["status"] == "todo" and first["priority"] == 0
    assert first["tags"] == []
    assert first["completed_at"] is None
    assert second["order_index"] > first["order_index"]

    r = client.get("/api/tasks", params={"list_id": lst["id"]})
    assert [t["id"] for t in r.json()] == [first["id"], second["id"]]


def test_subtasks_cascade_on_parent_delete(client):
    parent = make_task(client)
    child = make_task(client, title="Child", parent_id=parent["id"])

    assert client.get("/api/tasks", params={"top_level": True}).json() == [parent]

    r = client.delete(f"/api/tasks/{parent['id']}")
    assert r.status_code == 204
    assert client.get(f"/api/tasks/{child['id']}").status_code == 404


def test_task_get_children(client):
    parent = make_task(client)
    child = make_task(client, title="Child", parent_id=parent["id"])
    r = client.get(f"/api/tasks/{parent['id']}/children")
    assert [t["id"] for t in r.json()] == [child["id"]]


def test_parent_cycle_rejected(client):
    a = make_task(client, title="A")
    b = make_task(client, title="B", parent_id=a["id"])

    assert client.patch(f"/api/tasks/{a['id']}", json={"parent_id": a["id"]}).status_code == 400
    r = client.patch(f"/api/tasks/{a['id']}", json={"parent_id": b["id"]})
    assert r.status_code == 400


def test_completion_stamps_completed_at(client):
    task = make_task(client)
    r = client.patch(f"/api/tasks/{task['id']}", json={"status": "completed"})
    assert r.json()["completed_at"] is not None

    r = client.patch(f"/api/tasks/{task['id']}", json={"status": "todo"})
    assert r.json()["completed_at"] is None


def test_task_filters(client):
    t1 = make_task(client, title="Overdue", due_date="2026-09-10T10:00:00Z", tags=["work"])
    t2 = make_task(client, title="Future", due_date="2026-09-15T10:00:00Z", tags=["work", "deep"])
    t3 = make_task(client, title="Done", tags=[])
    client.patch(f"/api/tasks/{t3['id']}", json={"status": "completed"})

    overdue = client.get("/api/tasks", params={"overdue": True}).json()
    assert [t["id"] for t in overdue] == [t1["id"]]

    by_date = client.get("/api/tasks", params={"due_before": "2026-09-12T00:00:00Z"}).json()
    assert {t["id"] for t in by_date} == {t1["id"]}

    by_tag = client.get("/api/tasks", params={"tag": "deep"}).json()
    assert [t["id"] for t in by_tag] == [t2["id"]]

    done = client.get("/api/tasks", params={"status": "completed"}).json()
    assert [t["id"] for t in done] == [t3["id"]]

    assert client.get("/api/tasks", params={"tag": "nonexistent"}).json() == []


def test_due_date_can_be_cleared(client):
    task = make_task(client, due_date="2026-09-10T10:00:00Z")
    r = client.patch(f"/api/tasks/{task['id']}", json={"due_date": None})
    assert r.status_code == 200
    assert r.json()["due_date"] is None


def test_move_task_between_lists(client):
    lst_a = make_list(client, "A")
    lst_b = make_list(client, "B")
    task = make_task(client, list_id=lst_a["id"])

    r = client.patch(f"/api/tasks/{task['id']}", json={"list_id": lst_b["id"]})
    assert r.json()["list_id"] == lst_b["id"]
    assert client.patch(f"/api/tasks/{task['id']}", json={"list_id": "nope"}).status_code == 404


def test_reorder(client):
    tasks = [make_task(client, title=f"t{i}") for i in range(3)]
    new_order = [tasks[2]["id"], tasks[0]["id"], tasks[1]["id"]]

    r = client.post("/api/tasks/reorder", json={"ordered_ids": new_order})
    assert r.status_code == 200

    listing = client.get("/api/tasks").json()
    assert [t["id"] for t in listing] == new_order
    indexes = [t["order_index"] for t in listing]
    assert indexes == sorted(indexes)


def test_reorder_unknown_task(client):
    r = client.post("/api/tasks/reorder", json={"ordered_ids": ["missing"]})
    assert r.status_code == 404


def test_invalid_task_payloads(client):
    assert client.post("/api/tasks", json={"title": ""}).status_code == 422
    assert client.post("/api/tasks", json={"title": "x", "priority": 5}).status_code == 422
    assert client.post("/api/tasks", json={"title": "x", "parent_id": "ghost"}).status_code == 404


@pytest.mark.parametrize("status", ["todo", "in_progress", "completed", "canceled"])
def test_status_transitions_validated(client, status):
    task = make_task(client)
    r = client.patch(f"/api/tasks/{task['id']}", json={"status": status})
    assert r.status_code == 200
    assert r.json()["status"] == status
