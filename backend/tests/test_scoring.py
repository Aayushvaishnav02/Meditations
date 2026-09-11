from __future__ import annotations

from app.scoring import (
    DEFAULT_TARGET_DEEP_WORK_HOURS,
    DailyMetrics,
    clamp_nudge,
    compute_daily_score,
)


def test_perfect_day():
    m = DailyMetrics(
        tasks_completed=5, tasks_planned=5, deep_work_hours=4, habits_completed=2, habits_scheduled=2
    )
    b = compute_daily_score(m)
    assert (b.task_score, b.focus_score, b.habit_score) == (100, 100, 100)
    assert b.weighted_score == 90
    assert b.final_score == 90  # max without the LLM nudge


def test_nudge_is_bounded_and_pushes_final_to_100():
    m = DailyMetrics(
        tasks_completed=3, tasks_planned=3, deep_work_hours=4, habits_completed=2, habits_scheduled=2
    )
    b = compute_daily_score(m, llm_nudge=25)
    assert b.llm_nudge == 10
    assert b.final_score == 100


def test_nothing_planned_scores_zero_on_task_component():
    b = compute_daily_score(DailyMetrics(tasks_completed=0, tasks_planned=0))
    assert b.task_score == 0


def test_overachievement_is_capped():
    m = DailyMetrics(tasks_completed=10, tasks_planned=5, deep_work_hours=8)
    b = compute_daily_score(m)
    assert b.task_score == 100
    assert b.focus_score == 100


def test_habit_free_day_is_neutral_not_punitive():
    # task 100 (40) + focus 0 (0) + neutral habit (15)
    b = compute_daily_score(DailyMetrics(tasks_completed=1, tasks_planned=1))
    assert b.habit_score == 100
    assert b.weighted_score == 55


def test_zero_focus_target_is_neutral():
    b = compute_daily_score(DailyMetrics(), target_hours=0)
    assert b.focus_score == 100


def test_final_score_clamped_to_unit_range():
    # empty day: task 0 + focus 0 + neutral habit 15, minus full nudge
    b = compute_daily_score(DailyMetrics(), llm_nudge=-10)
    assert b.llm_nudge == -10
    assert b.final_score == 5  # floored at 0 in truly zero days; neutral habit keeps it at 5
    assert clamp_nudge(-50) == -10
    assert clamp_nudge(50) == 10


def test_partial_day_proportional():
    m = DailyMetrics(
        tasks_completed=2, tasks_planned=4, deep_work_hours=2, habits_completed=1, habits_scheduled=2
    )
    b = compute_daily_score(m, target_hours=4)
    assert b.task_score == 50
    assert b.focus_score == 50
    assert b.habit_score == 50
    assert b.weighted_score == 45  # 0.40+0.35+0.15 = 0.90 of the component scores
    assert b.final_score == 45
    assert b.target_deep_work_hours == DEFAULT_TARGET_DEEP_WORK_HOURS
