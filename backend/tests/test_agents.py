from __future__ import annotations

import datetime as dt

import pytest

import app.agents as agents
from app.util import monday_of, utc_now


# --- fixtures/helpers ---
def make_entry(client, day: str, text: str = "Journal text.") -> None:
    r = client.put(f"/api/journal/{day}", json={"raw_markdown": text})
    assert r.status_code == 200


@pytest.fixture()
def llm_daily(monkeypatch):
    """Stub the daily runner; records calls and returns a fixed nudge."""
    calls = []

    async def fake(deps, model=None, **kwargs):
        calls.append(deps)
        return agents.DailyReviewOutput(
            llm_nudge=8.0,
            nudge_rationale="Handled an emergency calmly.",
            feedback="Solid execution under pressure.",
            key_insight="You do your best work before noon.",
            suggested_action_for_tomorrow="Protect the morning block.",
        )

    monkeypatch.setattr(agents, "run_daily_review", fake)
    return calls


# --- daily rollup ---
def test_daily_rollup_persists_score(client, llm_daily):
    today = utc_now().date()
    make_entry(client, today.isoformat(), "Did the thing.")
    task = client.post("/api/tasks", json={"title": "Done today"}).json()
    client.patch(f"/api/tasks/{task['id']}", json={"status": "completed"})

    r = client.post("/api/agents/rollup/daily")
    assert r.status_code == 200
    body = r.json()
    assert body["persisted"] is True
    assert body["llm_nudge"] == 8.0
    assert body["final_score"] == pytest.approx(min(100, body["weighted_score"] + 8))
    assert body["feedback"] == "Solid execution under pressure."
    assert body["insight"] == "You do your best work before noon."

    # the scores endpoint now serves the persisted rollup
    stored = client.get(f"/api/scores/daily/{today}").json()
    assert stored["persisted"] is True and stored["llm_nudge"] == 8.0


def test_daily_rollup_bounded_context(client, llm_daily):
    today = utc_now().date()
    # an entry from 10 days ago must NOT reach the agent (7-day window)
    make_entry(client, (today - dt.timedelta(days=10)).isoformat(), "ancient history")
    make_entry(client, (today - dt.timedelta(days=2)).isoformat(), "recent day")
    make_entry(client, today.isoformat())

    client.post("/api/agents/rollup/daily")
    deps = llm_daily[0]
    assert [d["date"] for d in deps.past_days] == [(today - dt.timedelta(days=2)).isoformat()]
    assert deps.today_raw == "Journal text." or "Did" in deps.today_raw


def test_daily_rollup_without_entry_404(client, llm_daily):
    r = client.post("/api/agents/rollup/daily", params={"day": "2030-01-01"})
    assert r.status_code == 404
    assert not llm_daily  # the LLM is never called


# --- weekly rollup ---
@pytest.fixture()
def llm_weekly(monkeypatch):
    async def fake(deps, model=None, **kwargs):
        return agents.WeeklyReviewOutput(
            wins="Shipped the schema\nRan 4 times", misses="Late nights", carried_action_items="Keep the 25m pomodoros"
        )

    monkeypatch.setattr(agents, "run_weekly_review", fake)
    return fake


def test_weekly_rollup_averages_and_trend(client, llm_weekly):
    # fill the current ISO week with two journaled days
    monday = monday_of(utc_now().date())
    make_entry(client, monday.isoformat())
    make_entry(client, (monday + dt.timedelta(days=1)).isoformat())

    r = client.post("/api/agents/rollup/weekly")
    assert r.status_code == 200
    body = r.json()
    assert body["week_start"] == monday.isoformat()
    assert 0 <= body["avg_score"] <= 100
    assert body["wins"].startswith("Shipped")
    assert body["carried_action_items"] == "Keep the 25m pomodoros"


def test_weekly_rollup_empty_week_404(client, llm_weekly):
    r = client.post("/api/agents/rollup/weekly", params={"week_start": "2030-01-07"})
    assert r.status_code == 404


# --- monthly rollup ---
def test_monthly_rollup_from_weeks(client, llm_weekly, monkeypatch):
    async def fake_monthly(deps, model=None, **kwargs):
        assert len(deps.weeks) >= 2, "monthly agent needs the week rollups"
        return agents.MonthlyReviewOutput(narrative="A month of steady build-up.")

    monkeypatch.setattr(agents, "run_monthly_review", fake_monthly)

    # roll up two weeks of the current month (both fully inside it)
    today = utc_now().date()
    week1 = monday_of(today)
    week2 = week1 + dt.timedelta(days=7)
    make_entry(client, week1.isoformat())
    make_entry(client, week2.isoformat())
    client.post("/api/agents/rollup/weekly", params={"week_start": week1.isoformat()})
    client.post("/api/agents/rollup/weekly", params={"week_start": week2.isoformat()})

    r = client.post("/api/agents/rollup/monthly", params={"month": today.strftime("%Y-%m")})
    assert r.status_code == 200
    body = r.json()
    assert body["month"] == today.strftime("%Y-%m")
    assert body["narrative"] == "A month of steady build-up."
    assert body["trend"] in ("rising", "declining", "stable")


def test_monthly_rollup_without_weeks_404(client, monkeypatch):
    async def fake(deps, model=None, **kwargs):
        raise AssertionError("must not be called")

    monkeypatch.setattr(agents, "run_monthly_review", fake)
    r = client.post("/api/agents/rollup/monthly", params={"month": "2030-01"})
    assert r.status_code == 404


# --- decomposition ---
def test_decompose_creates_subtasks(client, monkeypatch):
    async def fake(title, description, today, model=None, **kwargs):
        return agents.DecompositionOutput(
            subtasks=[
                agents.SubtaskItem(title="Draft outline", estimated_minutes=30, priority=2),
                agents.SubtaskItem(title="Write first pass", estimated_minutes=90, priority=3),
            ],
            advice="Do the outline before lunch.",
        )

    monkeypatch.setattr(agents, "run_task_decomposition", fake)

    task = client.post("/api/tasks", json={"title": "Write proposal"}).json()
    r = client.post("/api/agents/decompose", json={"task_id": task["id"]})
    assert r.status_code == 200
    body = r.json()
    assert body["advice"] == "Do the outline before lunch."

    children = client.get(f"/api/tasks/{task['id']}/children").json()
    assert [c["title"] for c in children] == ["Draft outline", "Write first pass"]
    assert children[0]["estimated_minutes"] == 30 and children[0]["priority"] == 2


def test_decompose_unknown_task(client):
    assert client.post("/api/agents/decompose", json={"task_id": "ghost"}).status_code == 404


# --- capture ---
def test_capture_creates_tasks_and_journal_snippet(client, monkeypatch):
    async def fake(text, today, model=None, **kwargs):
        return agents.CaptureOutput(
            tasks=[
                agents.CapturedTask(title="Email Alex the deck", due_date=today.isoformat(), due_time="16:00", priority=3, tags=["work"]),
                agents.CapturedTask(title="Schedule team sync", due_date=None),
            ],
            journal_snippet="Spoke with Alex about the launch deck.",
        )

    monkeypatch.setattr(agents, "run_capture", fake)
    today = utc_now().date().isoformat()

    r = client.post("/api/agents/capture", json={"text": "Spoke with Alex. Email him the deck by 4pm today and schedule a sync."})
    assert r.status_code == 200
    body = r.json()
    assert len(body["tasks"]) == 2
    assert body["tasks"][0]["due_date"] is not None  # composed to UTC ISO
    assert body["journal_snippet"] == "Spoke with Alex about the launch deck."

    # snippet appended to today's journal (created on the fly)
    entry = client.get(f"/api/journal/{today}").json()
    assert "### Captured" in entry["raw_markdown"]
    assert "launch deck" in entry["raw_markdown"]

    tasks = client.get("/api/tasks").json()
    assert any(t["title"] == "Email Alex the deck" and t["priority"] == 3 for t in tasks)


# --- briefing ---
def test_briefing(client, monkeypatch):
    async def fake(deps, model=None, **kwargs):
        assert isinstance(deps, dict) and "overdue_tasks" in deps
        return agents.BriefingOutput(
            top_focus=["Finish the schema migration", "Reply to Alex", "30 min review"],
            reasoning="Carry-over first, then communication debt.",
        )

    monkeypatch.setattr(agents, "run_briefing", fake)

    # one overdue task
    t = client.post("/api/tasks", json={"title": "Overdue thing", "due_date": "2020-01-01T10:00:00"}).json()
    r = client.post("/api/agents/briefing")
    assert r.status_code == 200
    body = r.json()
    assert len(body["top_focus"]) == 3
    assert body["overdue_count"] == 1


# --- pydantic-ai wiring (no network): TestModel proves schema/prompt plumbing ---
def test_agent_runners_wire_structured_outputs():
    """Each runner must produce its typed output against pydantic-ai's TestModel,
    validating prompts, output schemas and retry wiring without any network."""
    import asyncio

    from pydantic_ai.models.test import TestModel

    daily = agents.run_daily_review(
        agents.DailyDeps(
            day=dt.date(2026, 9, 11),
            today_raw="entry",
            past_days=[{"date": "2026-09-10", "score": 50.0, "raw": "yesterday"}],
            metrics={"tasks_completed": 1},
        ),
        model=TestModel(),
    )
    weekly = agents.run_weekly_review(
        agents.WeeklyDeps(week_start=dt.date(2026, 9, 7), days=[{"date": "2026-09-07", "score": 60.0, "tasks_done": 1, "tasks_planned": 2, "deep_work_hours": 1.0}]),
        model=TestModel(),
    )
    monthly = agents.run_monthly_review(
        agents.MonthlyDeps(month="2026-09", weeks=[{"week_start": "2026-09-07", "avg_score": 55.0, "trend": "stable", "wins": "w", "misses": "m", "carried": "c"}]),
        model=TestModel(),
    )
    decompose = agents.run_task_decomposition("Plan launch", None, dt.date(2026, 9, 11), model=TestModel())
    capture = agents.run_capture("email alex tomorrow", dt.date(2026, 9, 11), model=TestModel())
    briefing = agents.run_briefing({"overdue_tasks": [], "due_today": []}, model=TestModel())

    async def run_all():
        return await asyncio.gather(daily, weekly, monthly, decompose, capture, briefing)

    out_daily, out_weekly, out_monthly, out_decompose, out_capture, out_briefing = asyncio.run(run_all())
    assert isinstance(out_daily, agents.DailyReviewOutput)
    assert isinstance(out_weekly, agents.WeeklyReviewOutput)
    assert isinstance(out_monthly, agents.MonthlyReviewOutput)
    assert isinstance(out_decompose, agents.DecompositionOutput)
    assert isinstance(out_capture, agents.CaptureOutput)
    assert isinstance(out_briefing, agents.BriefingOutput)
