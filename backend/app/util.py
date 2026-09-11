from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone


def utc_now() -> datetime:
    """Naive UTC (the DB/API convention: all datetimes are UTC, no tzinfo)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_id() -> str:
    return uuid.uuid4().hex


def normalize_dt(value: datetime | None) -> datetime | None:
    """Normalize to naive UTC; naive input is assumed to already be UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def day_bounds(day: date) -> tuple[datetime, datetime]:
    """UTC [start, end) interval covering the given calendar day (naive UTC)."""
    start = datetime.combine(day, time.min)
    return start, start + timedelta(days=1)


def monday_of(day: date) -> date:
    """Monday of the ISO week containing the given day."""
    return day - timedelta(days=day.weekday())
