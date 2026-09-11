# Journal — local-first life-OS

Tasks (TickTick-grade), reflective journaling (TipTap), and a hierarchical AI
compaction system (PydanticAI) in one local app. See [plan.md](plan.md) for the
full architecture.

```
backend/    FastAPI + SQLite (WAL) + FTS5 + sqlite-vec + PydanticAI agents
frontend/   React 19 + Vite + Tailwind v4 + shadcn/Base-UI + TipTap + Tauri v2 shell
systemd/    user timers for nightly/weekly/monthly AI rollups
```

## Quick start (dev)

```bash
# 1. backend — API on :8000
cd backend && uv sync && uv run uvicorn app.main:app --reload

# 2. frontend — UI on :5173
cd frontend && npm install && npm run dev
```

Optional AI: point the app at any OpenAI-compatible endpoint (defaults to local
Ollama) — `backend/.env` or the settings API, see `backend/README.md`.

## Desktop build (Tauri v2)

Prerequisites on EndeavourOS/Arch:

```bash
sudo pacman -S --needed rust webkit2gtk-4.1 gtk3 base-devel
# or: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

```bash
cd frontend
npm run tauri dev     # desktop app with tray + Super+Shift+A quick-add focus
npm run tauri build   # appimage/deb/rpm in src-tauri/target/release/bundle/
```

## Scheduled AI rollups

```bash
./systemd/install.sh   # daily 23:30 · weekly Sun 23:59 · monthly 1st 00:05
```
