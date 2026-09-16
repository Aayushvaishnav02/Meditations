"""Packaged-app entrypoint: uvicorn serving app.main:app on loopback.

The Tauri shell spawns this binary with MEDITATIONS_PORT (a free port it
picked) and JOURNAL_DB_PATH (the app-data dir); the env defaults keep it
runnable standalone for debugging an installed app:

    MEDITATIONS_PORT=8747 ./meditations-backend
"""

from __future__ import annotations

import os
import threading


def _watch_parent() -> None:
    """Exit when the desktop shell dies, even on SIGKILL — prevents an
    orphaned backend holding the DB and its port after a shell crash."""
    import time

    parent = os.getppid()
    while True:
        time.sleep(2)
        if os.getppid() != parent:
            os._exit(0)


def main() -> None:
    import uvicorn

    from app.main import app

    threading.Thread(target=_watch_parent, daemon=True).start()

    uvicorn.run(
        app,
        host=os.environ.get("MEDITATIONS_HOST", "127.0.0.1"),
        port=int(os.environ.get("MEDITATIONS_PORT", "8747")),
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    main()
