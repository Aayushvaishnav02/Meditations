"""Expands the RRULE subset the quick-add bar generates (plan §6.1).

Supported: FREQ=DAILY, FREQ=WEEKLY[;BYDAY=MO,TU,...][;INTERVAL=n].
Anything else parses to None (task simply won't regenerate).
"""

from __future__ import annotations

import datetime as dt

WEEKDAY_MAP = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def parse_rrule(rule: str) -> dict | None:
    parts: dict[str, str] = {}
    for chunk in rule.replace("RRULE:", "").split(";"):
        if "=" in chunk:
            key, value = chunk.split("=", 1)
            parts[key.strip().upper()] = value.strip().upper()

    freq = parts.get("FREQ", "")
    if freq not in ("DAILY", "WEEKLY"):
        return None
    try:
        interval = max(1, int(parts.get("INTERVAL", "1")))
    except ValueError:
        return None
    byday = [d for d in parts.get("BYDAY", "").split(",") if d in WEEKDAY_MAP]
    return {"freq": freq, "interval": interval, "byday": byday}


def next_occurrence(rule: str, after: dt.datetime) -> dt.datetime | None:
    """Next occurrence strictly after `after`, keeping its time of day."""
    parsed = parse_rrule(rule)
    if parsed is None:
        return None
    base = after.date()

    if parsed["freq"] == "DAILY":
        return dt.datetime.combine(
            base + dt.timedelta(days=parsed["interval"]),
            after.timetz(),
        )

    days = [WEEKDAY_MAP[d] for d in parsed["byday"]] or [base.weekday()]
    base_week = base - dt.timedelta(days=base.weekday())
    for offset in range(1, 7 * parsed["interval"] + 8):  # at least one full cycle
        candidate = base + dt.timedelta(days=offset)
        week_distance = ((candidate - base_week).days) // 7
        if candidate.weekday() in days and week_distance % parsed["interval"] == 0:
            return dt.datetime.combine(candidate, after.timetz())
    return None
