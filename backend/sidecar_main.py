"""Packaged-app entrypoint: uvicorn serving app.main:app on loopback.

The Tauri shell spawns this binary with MEDITATIONS_PORT (a free port it
picked) and JOURNAL_DB_PATH (the app-data dir); the env defaults keep it
runnable standalone for debugging an installed app:

    MEDITATIONS_PORT=8747 ./meditations-backend
"""

from __future__ import annotations

import os


def main() -> None:
    import uvicorn

    from app.main import app

    uvicorn.run(
        app,
        host=os.environ.get("MEDITATIONS_HOST", "127.0.0.1"),
        port=int(os.environ.get("MEDITATIONS_PORT", "8747")),
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()
