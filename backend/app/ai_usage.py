"""Persists one AiUsage row per LLM call (observability; never affects scoring)."""

from __future__ import annotations

from sqlmodel.ext.asyncio.session import AsyncSession

from app.agents import OnUsage, UsageReport
from app.models import AiUsage
from app.util import new_id


def make_recorder(session: AsyncSession) -> OnUsage:
    async def record(report: UsageReport) -> None:
        session.add(
            AiUsage(
                id=new_id(),
                agent=report.agent,
                model=report.model,
                input_tokens=report.input_tokens,
                output_tokens=report.output_tokens,
                duration_ms=report.duration_ms,
            )
        )
        await session.commit()

    return record
