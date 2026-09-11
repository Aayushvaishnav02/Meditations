from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from app import db

SessionDep = Annotated[AsyncSession, Depends(db.get_session)]
