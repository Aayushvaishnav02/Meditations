from __future__ import annotations

import datetime as dt
import json

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import select

import app.agents as agents
from app.models import DailyScore, JournalEntry, MonthlySummary, Task, WeeklySummary
from app.routers.deps import SessionDep
from app.routers.scores import DailyScoreResponse
from app.scoring import ScoreBreakdown, compute_daily_score
from app.telemetry import collect_daily_metrics
from app.util import monday_of, new_id, utc_now

router = APIRouter(prefix="/api/agents", tags=["agents"])


def trend_of(scores: list[float]) -> str:
    if len(scores) < 3:
        return "stable"
    mid = len(scores) // 2
    diff = sum(scores[mid:]) / len(scores[mid:]) - sum(scores[:mid]) / len(scores[:mid])
    if diff > 5:
        return "rising"
    if diff < -5:
        return "declining"
    return "stable"


async def _llm_call(awaitable_factory) -> object:
    try:
        return await awaitable_factory
    except Exception as exc:  # noqa: BLE001 — surface provider errors to the user
        raise HTTPException(status_code=502, detail=f"AI request failed: {exc}") from exc


def _score_response(day: dt.date, breakdown: ScoreBreakdown, row: DailyScore) -> DailyScoreResponse:
    return DailyScoreResponse(
        date=day,
        task_score=breakdown.task_score,
        focus_score=breakdown.focus_score,
        habit_score=breakdown.habit_score,
        weighted_score=breakdown.weighted_score,
        llm_nudge=row.llm_nudge,
        final_score=row.final_score,
        target_deep_work_hours=breakdown.target_deep_work_hours,
        metrics=breakdown.metrics,
        persisted=True,
        feedback=row.feedback,
        insight=row.insight,
    )


@router.post("/rollup/daily", response_model=DailyScoreResponse)
async def rollup_daily(session: SessionDep, day: dt.date | None = None):
    """Run the daily review agent for one journal day and persist its score."""
    day = day or utc_now().date()
    entry = await session.get(JournalEntry, day)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No journal entry for {day}; write one first.")

    metrics = await collect_daily_metrics(session, day)
    breakdown = compute_daily_score(metrics)

    past_days: list[dict] = []
    for offset in range(1, 7):
        d = day - dt.timedelta(days=offset)
        past_entry = await session.get(JournalEntry, d)
        if past_entry is None:
            continue
        past_score = await session.get(DailyScore, d)
        past_days.append({"date": str(d), "score": past_score.final_score if past_score else None, "raw": past_entry.raw_markdown})

    current_week_start = monday_of(day)
    latest_weekly = (
        await session.exec(
            select(WeeklySummary).where(WeeklySummary.week_start < current_week_start).order_by(WeeklySummary.week_start.desc())
        )
    ).first()
    latest_monthly = (
        await session.exec(
            select(MonthlySummary).where(MonthlySummary.month < day.strftime("%Y-%m")).order_by(MonthlySummary.month.desc())
        )
    ).first()

    review: agents.DailyReviewOutput = await _llm_call(
        agents.run_daily_review(
            agents.DailyDeps(
                day=day,
                today_raw=entry.raw_markdown,
                past_days=past_days,
                weekly_context=(latest_weekly.wins + "\n" + (latest_weekly.misses or "")) if latest_weekly else None,
                monthly_context=latest_monthly.narrative if latest_monthly else None,
                metrics=metrics.model_dump(),
            )
        )
    )

    final = min(100.0, max(0.0, breakdown.weighted_score + review.llm_nudge))
    row = DailyScore(
        date=day,
        deterministic_score=breakdown.weighted_score,
        llm_nudge=review.llm_nudge,
        final_score=final,
        rubric_breakdown_json=json.dumps(
            {
                **breakdown.model_dump(),
                "nudge_rationale": review.nudge_rationale,
                "suggested_action_for_tomorrow": review.suggested_action_for_tomorrow,
            },
            default=str,
        ),
        feedback=review.feedback,
        insight=review.key_insight,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _score_response(day, breakdown, row)


@router.post("/rollup/weekly")
async def rollup_weekly(session: SessionDep, week_start: dt.date | None = None):
    """Roll up one ISO week (Mon-based). Defaults to the current week; the
    systemd timer fires Sunday 23:59 so the default is the completed week."""
    week_start = week_start or monday_of(utc_now().date())
    week_end = week_start + dt.timedelta(days=7)

    entries = (
        await session.exec(
            select(JournalEntry).where(JournalEntry.date >= week_start, JournalEntry.date < week_end).order_by(JournalEntry.date)
        )
    ).all()
    if not entries:
        raise HTTPException(status_code=404, detail=f"No journal entries in week {week_start}.")

    days: list[dict] = []
    scores: list[float] = []
    for entry in entries:
        stored = await session.get(DailyScore, entry.date)
        metrics = await collect_daily_metrics(session, entry.date)
        score = stored.final_score if stored else compute_daily_score(metrics).weighted_score
        scores.append(score)
        days.append(
            {
                "date": str(entry.date),
                "score": score,
                "tasks_done": metrics.tasks_completed,
                "tasks_planned": metrics.tasks_planned,
                "deep_work_hours": metrics.deep_work_hours,
            }
        )

    past_weeks = [
        {
            "week_start": str(w.week_start),
            "avg_score": w.avg_score,
            "wins": w.wins,
            "misses": w.misses,
            "carried": w.carried_action_items,
        }
        for w in (
            await session.exec(
                select(WeeklySummary).where(WeeklySummary.week_start < week_start).order_by(WeeklySummary.week_start.desc()).limit(4)
            )
        ).all()
    ][::-1]
    latest_monthly = (
        await session.exec(select(MonthlySummary).order_by(MonthlySummary.month.desc()).limit(1))
    ).first()

    trend = trend_of(scores)
    review: agents.WeeklyReviewOutput = await _llm_call(
        agents.run_weekly_review(
            agents.WeeklyDeps(
                week_start=week_start,
                days=days,
                past_weeks=past_weeks,
                monthly_context=latest_monthly.narrative if latest_monthly else None,
                trend=trend,
            )
        )
    )

    week = await session.get(WeeklySummary, week_start)
    if week is None:
        week = WeeklySummary(week_start=week_start, avg_score=sum(scores) / len(scores), trend=trend)
    week.avg_score = sum(scores) / len(scores)
    week.trend = trend
    week.wins = review.wins
    week.misses = review.misses
    week.carried_action_items = review.carried_action_items
    session.add(week)
    await session.commit()
    await session.refresh(week)
    return week


@router.post("/rollup/monthly")
async def rollup_monthly(session: SessionDep, month: str | None = Query(default=None)):
    """Roll up one month ('YYYY-MM', or 'previous'/None). Defaults to the
    current month, or the previous one on the 1st (when the timer fires)."""
    today = utc_now().date()
    if month == "previous" or (month is None and today.day == 1):
        first_of_this = today.replace(day=1)
        last_of_prev = first_of_this - dt.timedelta(days=1)
        month = last_of_prev.strftime("%Y-%m")
    try:
        year, mon = (int(p) for p in month.split("-"))
        month_start = dt.date(year, mon, 1)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="month must be 'YYYY-MM' or 'previous'") from exc

    weeks = [
        w
        for w in (
            await session.exec(select(WeeklySummary).order_by(WeeklySummary.week_start))
        ).all()
        if w.week_start.year == year and w.week_start.month == mon
    ]
    if not weeks:
        raise HTTPException(status_code=404, detail=f"No weekly rollups found for {month}; run weekly rollups first.")

    avg = sum(w.avg_score for w in weeks) / len(weeks)
    trend = trend_of([w.avg_score for w in weeks])
    past_months = [
        {"month": m.month, "avg_score": m.avg_score, "trend": m.trend, "narrative": m.narrative}
        for m in (
            await session.exec(select(MonthlySummary).where(MonthlySummary.month < month).order_by(MonthlySummary.month.desc()).limit(3))
        ).all()
    ][::-1]

    review: agents.MonthlyReviewOutput = await _llm_call(
        agents.run_monthly_review(
            agents.MonthlyDeps(
                month=month,
                weeks=[
                    {"week_start": str(w.week_start), "avg_score": w.avg_score, "trend": w.trend, "wins": w.wins, "misses": w.misses, "carried": w.carried_action_items}
                    for w in weeks
                ],
                past_months=past_months,
                trend=trend,
            )
        )
    )

    row = await session.get(MonthlySummary, month)
    if row is None:
        row = MonthlySummary(month=month, avg_score=avg, trend=trend)
    row.avg_score = avg
    row.trend = trend
    row.narrative = review.narrative
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


class DecomposeRequest(BaseModel):
    task_id: str


@router.post("/decompose")
async def decompose_task(body: DecomposeRequest, session: SessionDep):
    """Break a task into AI-planned subtasks and persist them under it."""
    task = await session.get(Task, body.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    review: agents.DecompositionOutput = await _llm_call(
        agents.run_task_decomposition(task.title, task.description, utc_now().date())
    )

    created = []
    for i, sub in enumerate(review.subtasks):
        subtask = Task(
            id=new_id(),
            title=sub.title,
            parent_id=task.id,
            list_id=task.list_id,
            priority=sub.priority,
            estimated_minutes=sub.estimated_minutes,
            order_index=float(i) * 1000.0,
        )
        session.add(subtask)
        created.append(subtask)
    await session.commit()
    for sub in created:
        await session.refresh(sub)
    return {"subtasks": created, "advice": review.advice}


class CaptureRequest(BaseModel):
    text: str


@router.post("/capture")
async def capture(body: CaptureRequest, session: SessionDep):
    """Conversational capture: extract tasks from free text, register them and
    append the snippet to today's journal (plan §6.3.4)."""
    review: agents.CaptureOutput = await _llm_call(agents.run_capture(body.text, utc_now().date()))

    created = []
    for item in review.tasks:
        due_utc: dt.datetime | None = None
        if item.due_date:
            try:
                naive = dt.datetime.fromisoformat(f"{item.due_date}T{item.due_time or '09:00'}")
                # server runs on the user's machine: naive input == local time
                due_utc = naive.astimezone(dt.timezone.utc).replace(tzinfo=None)
            except ValueError as exc:
                raise HTTPException(status_code=502, detail=f"AI returned an invalid date: {item.due_date}") from exc
        task = Task(id=new_id(), title=item.title, due_date=due_utc, priority=item.priority, tags=item.tags)
        session.add(task)
        created.append(task)

    snippet = review.journal_snippet.strip()
    if snippet:
        today = utc_now().date()
        entry = await session.get(JournalEntry, today)
        block = f"\n\n### Captured\n{snippet}\n"
        if entry is None:
            entry = JournalEntry(date=today, raw_markdown=f"### Captured\n{snippet}\n")
        else:
            entry.raw_markdown += block
            entry.updated_at = utc_now()
        session.add(entry)

    await session.commit()
    for task in created:
        await session.refresh(task)
    return {"tasks": created, "journal_snippet": snippet}


@router.post("/briefing")
async def morning_briefing(session: SessionDep):
    """Conversational daily planning: recommends the Top 3 focus (plan §6.3.3)."""
    now = utc_now()
    today = now.date()

    overdue = (
        await session.exec(
            select(Task)
            .where(Task.due_date < now, Task.status.in_(["todo", "in_progress"]))
            .order_by(Task.due_date)
            .limit(20)
        )
    ).all()
    day_end = now.replace(hour=23, minute=59, second=59, microsecond=0)
    due_today = (
        await session.exec(
            select(Task)
            .where(Task.due_date >= now.replace(hour=0, minute=0, second=0), Task.due_date <= day_end, Task.status.in_(["todo", "in_progress"]))
            .limit(30)
        )
    ).all()

    yesterday = today - dt.timedelta(days=1)
    y_entry = await session.get(JournalEntry, yesterday)
    y_score = await session.get(DailyScore, yesterday)

    review: agents.BriefingOutput = await _llm_call(
        agents.run_briefing(
            {
                "overdue_tasks": [f"{t.title} (due {t.due_date})" for t in overdue],
                "due_today": [t.title for t in due_today],
                "yesterday_feedback": y_score.feedback if y_score else None,
                "yesterday_journal_excerpt": (y_entry.raw_markdown[-1500:] if y_entry else None),
                "open_tasks_total": len(
                    (await session.exec(select(Task).where(Task.status.in_(["todo", "in_progress"])))).all()
                ),
            }
        )
    )
    return {
        "top_focus": review.top_focus[:3],
        "reasoning": review.reasoning,
        "overdue_count": len(overdue),
        "due_today_count": len(due_today),
    }
