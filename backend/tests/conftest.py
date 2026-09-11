from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app


@pytest.fixture()
def client():
    db.init_engine("sqlite+aiosqlite:///:memory:")
    with TestClient(app) as c:
        yield c
