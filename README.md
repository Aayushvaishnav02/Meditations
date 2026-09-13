# Meditations — local-first life-OS

A single local app that combines **TickTick-grade task management**, **reflective
journaling** (TipTap markdown), and a **hierarchical AI compaction system**
(PydanticAI). Everything runs on your machine: SQLite storage, local-first API,
optional AI against any OpenAI-compatible endpoint (defaults to a local Ollama).

> The full architecture deep-dive lives in `plan.md` (kept locally, not in the
> repository).

## Features

- **Quick-add capture** — natural-language parsing: `buy milk tomorrow 5pm !1 #personal @errands ~10m`
  with chrono-node dates, `!1/!2/!3` priorities, `#lists`, `@tags`, `~durations`,
  and `every mon, wed` recurrence (RRULE subset).
- **Task views** — list sections (Overdue / Today / Tomorrow / Upcoming / No date /
  Completed), Kanban board with drag-and-drop, subtasks, inline rename, and
  recurring-task clones on completion.
- **Journal** — one markdown entry per day with mood/energy ratings, tipTap editor,
  and a hard rule that a day is never auto-created empty.
- **Hybrid search** — SQLite FTS5 (keyword) + sqlite-vec (semantic embeddings via
  fastembed), with a distance cap so tiny indexes never over-match.
- **AI reviews** — daily / weekly / monthly compaction agents with strictly bounded
  context (the daily agent reads today + 6 past days + latest rollups; token cost
  is O(1) regardless of history), plus daily briefing, capture assists, and Q&A —
  all streamed to the UI over SSE.
- **Daily score** — deterministic and never LLM-computed:
  `0.40*task + 0.35*focus + 0.15*habit + clamp(llm_nudge, ±10)`; unconfigured
  components are neutral, never punitive.
- **Desktop shell** — Tauri v2 with system tray (show/quit) and a
  `Super+Shift+A` global shortcut that focuses the app from anywhere.

## Layout

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
Ollama) — via `backend/.env` or the in-app Settings. There are two model tiers:
a **main model** (reviews, decomposition) and a **fast tier** (capture, briefing,
Q&A, assists) that falls back to the main model. Per-agent prompt overrides live
in `app_settings`. Details in `backend/README.md`.

## Scheduled AI rollups

```bash
./systemd/install.sh   # daily 23:30 · weekly Sun 23:59 · monthly 1st 00:05
```

## Desktop app (Tauri v2)

### With a native toolchain (recommended)

Install the prerequisites, then build from `frontend/`:

```bash
# Fedora
sudo dnf install rust cargo webkit2gtk4.1-devel libappindicator-gtk3-devel \
                 libdbusmenu-gtk3-devel librsvg2-devel gcc gcc-c++
# Arch / EndeavourOS
sudo pacman -S --needed rust webkit2gtk-4.1 gtk3 base-devel
# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file
```

```bash
cd frontend
npm run tauri dev     # desktop app with tray + Super+Shift+A quick-add focus
npm run tauri build   # appimage/deb/rpm in src-tauri/target/release/bundle/
```

### Without root — vendored sysroot

Sandboxes, containers, or WSL images without sudo can vendor the whole
toolchain into the repo (no system changes). The two scripts are tracked in
`.tauri-sysroot/`:

```bash
# 1. vendor rustup + the webkit RPM dependency chain into .tauri-sysroot/
mkdir -p .tauri-sysroot/rpms && (cd .tauri-sysroot/rpms \
  && dnf download --resolve --alldeps webkit2gtk4.1-devel \
       libappindicator-gtk3-devel libdbusmenu-gtk3-devel librsvg2-devel)
export RUSTUP_HOME="$PWD/.tauri-sysroot/rustup" CARGO_HOME="$PWD/.tauri-sysroot/cargo"
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --no-modify-path
bash .tauri-sysroot/extract.sh          # extract RPMs, repoint pkg-config files

# 2. build (deb + rpm)
export PATH="$PWD/.tauri-sysroot/cargo/bin:$PATH" \
       PKG_CONFIG_PATH="$PWD/.tauri-sysroot/root/usr/lib64/pkgconfig:$PWD/.tauri-sysroot/root/usr/share/pkgconfig"
cd frontend && npm run tauri build -- --bundles deb,rpm

# 3. AppImage: an appimage bundle attempt prepares the AppDir, then fails at
#    linuxdeploy (expected — it can't see the vendored libs); finish with:
(cd frontend && npm run tauri build -- --bundles appimage) || true
bash .tauri-sysroot/build-appimage.sh
```

Gotchas baked into this flow (see `AGENTS.md` for the full list):

- the Tauri bundler resolves `libappindicator` via pkg-config even for deb/rpm
  targets — keep `appindicator3-0.1` + `dbusmenu-glib-0.4` pc files reachable;
- tauri's pinned linuxdeploy bundles an outdated `strip` that rejects modern
  `.relr.dyn` sections — `build-appimage.sh` uses a current linuxdeploy build
  and pre-populates the AppDir because linuxdeploy cannot see non-system libs.

## Testing

```bash
cd backend  && uv run pytest        # backend suite (in-memory SQLite)
cd frontend && npm run test         # vitest (quick-add parser, date helpers)
cd frontend && npm run build        # tsc -b + vite build — must pass before commit
```

Agent tests never touch the network (runners are monkeypatched / `TestModel`),
and the semantic-search tests stub `embed_texts` — no real fastembed model.

## Data contracts (the short version)

- **Datetimes are naive UTC everywhere** — SQLite drops offsets on read; the
  backend normalizes on write (`app/util.py`), the frontend parses with
  `parseUTC()` and sends `toISOString()`.
- **Scores are deterministic** (`backend/app/scoring.py`) — LLMs never compute
  scores or trends, they only contribute a clamped nudge.
- **AI context is bounded** — daily reads 7 days + latest rollups, weekly reads
  only daily scores, monthly only weekly rollups.
- **Journal entries must carry content, mood, or energy** — the API refuses
  fully empty saves and deletes emptied entries; visiting a day never creates
  one.
- **One tasks cache** (`["tasks"]` in `frontend/src/hooks/api.ts`) — grouping and
  filtering happen client-side; every mutation is optimistic with rollback.
