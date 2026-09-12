# AGENTS.md

Instructions for AI coding agents working on this repository.

## Project

Journal is a local-first personal life-OS: tasks (TickTick-grade), long-form
journaling (TipTap markdown), and a hierarchical AI compaction system
(PydanticAI). `plan.md` is the authoritative architecture document; keep it in
sync when behavior changes.

| Path | Contents |
|---|---|
| `backend/` | FastAPI + SQLite (WAL) + FTS5 + sqlite-vec + PydanticAI |
| `backend/app/` | `models.py` (all tables), `scoring.py` (deterministic score), `telemetry.py` (day aggregation), `search.py` (hybrid FTS+vec), `agents.py` (LLM runners), `ai_factory.py` (model factory + retry/transport), `ai_usage.py` (token telemetry), `sse.py` (SSE framing), `recurrence.py`, `db.py` |
| `backend/app/routers/` | One module per resource; `deps.py` holds `SessionDep` |
| `frontend/src/` | React 19 + Vite + Tailwind v4 + shadcn v4 (Base UI) + TipTap v3 |
| `frontend/src/hooks/api.ts` | ALL React Query hooks with optimistic updates |
| `frontend/src/stores/` | Zustand: `ui.ts` (section/view/scope/theme), `timer.ts` (focus clock) |
| `systemd/` | User-level timers for AI rollups |

## Commands

Run from `backend/` unless noted. Verify before every commit.

```bash
uv run pytest                                  # backend tests (88 as of 2026-09)
uv run uvicorn app.main:app --reload           # API on :8000
cd frontend && npm run test                    # vitest (9 tests)
npm run build                                  # tsc -b + vite build; MUST pass before commit
npm run dev                                    # UI on :5173
npm run tauri dev | build                      # desktop shell (needs rust + webkit2gtk-4.1)
```

## Git

- Branch per feature: `feat/<name>`, `fix/<name>`. Conventional Commits, single
  line (plan.md §10.3).
- Merge with `git merge --no-ff`. The user requires a subagent review before
  merging non-trivial branches; fix BLOCKER findings before merging.
- Direct commits to `main` are allowed for docs and one-line fixes only.
- Never track: `data/`, `*.db`, `.env`, `dist/`, `src-tauri/target/`,
  `node_modules/`, `.venv/`.

## Data contracts

- **Datetimes are naive UTC everywhere.** SQLite's dialect stores offsets but
  drops them on read, so aware round-trips are asymmetric. Backend:
  `normalize_dt()` in `app/util.py`. Frontend: `parseUTC()` appends `Z` to
  offset-less strings; outgoing dates use `toISOString()`. A datetime MUST NOT
  be stored with a tzinfo.
- **Score formula** (plan §3.4): `0.40*task + 0.35*focus + 0.15*habit +
  clamp(llm_nudge, ±10)`. Weights sum to 0.90. Unconfigured components are
  neutral (100), never punitive. LLMs MUST NOT compute scores or trends;
  `app/scoring.py` and `trend_of()` do that.
- **Bounded AI context** (plan §3.3): the daily agent reads today + 6 past days
  (500 chars each) + latest weekly/monthly summaries. Weekly reads only daily
  scores, never raw journals. Monthly reads only weekly rollups. Token cost is
  O(1) regardless of history. Do not widen these windows.
- **Journal entries MUST carry content, mood, or energy.** `PUT
  /api/journal/{day}` refuses fully empty saves and deletes emptied entries;
  visiting a day MUST NOT create one (tiptap-markdown's `setContent` emits an
  update — guard with the baseline check in `journal-editor.tsx`).
- **Debounced journal saves freeze their payload at schedule time**
  (`pendingSave` in `journal-editor.tsx`): day, markdown and ratings are
  captured when the timer is armed, because a day switch or React state timing
  must never redirect a save to the wrong day. Rating clicks pass their new
  value explicitly (`scheduleSave(editor, true, { mood: v })`) — refs still
  hold the previous render's value at that point.
- **One tasks cache** (`["tasks"]` in `hooks/api.ts`): grouping and filtering
  happen client-side. Every mutation MUST implement the optimistic pattern:
  snapshot in `onMutate`, restore in `onError`, invalidate in `onSettled`.
- **Subtasks are tasks** with `parent_id`; deletion cascades via FKs
  (`PRAGMA foreign_keys=ON` per connection). Recurring tasks spawn a clone on
  completion; the finished instance stays completed so telemetry survives.
- **A journal day without an entry has no score row.** `daily_scores` rows are
  written only by the daily-rollup agent; everything else computes live.
  Re-running a review UPSERTS the row (`_persist_daily`) — the date is the PK.
- **Streaming AI endpoints** (`/api/agents/*/stream`) speak SSE: `partial`
  (cumulative text or partial object) → `done` (final payload) or `error`
  (human-readable via `describe_ai_error`). Frontend consumes them with plain
  fetch + ReadableStream (`lib/stream.ts`), no EventSource (POST bodies).
- **Two model tiers**: the main model (reviews, decomposition) and the fast
  tier (`ai_fast_model_name`, used by capture/briefing/Q&A/assists; falls back
  to the main model). Both go through `ResilientModel` (retries 429/5xx +
  connection errors; streams only retry before the first yielded chunk).
- **Prompt overrides** live in `app_settings` as `prompt_<key>`; `PROMPT_KEYS`
  (ai_factory) and `PROMPT_DEFAULTS` (agents.py) must stay in sync — asserted
  in tests. Every runner accepts `system_prompt=` and `on_usage=` overrides.

## Architecture traps (these caused real bugs; do not reintroduce them)

- **pydantic-ai v2** (not 0.x): `OpenAIChatModel` + provider objects carry
  `base_url`/`api_key`; agents use `output_type=`, results in `result.output`.
- **Personal AI gateways mask upstream 429s as HTTP 503** (Antigravity, some
  Ollama proxies) and rate-limit aggressively; pydantic-ai's `retries=` does
  NOT cover HTTP errors. `create_agent_model()` wraps every model in
  `ResilientModel` (spaced retries on 429/5xx); user-facing errors go through
  `describe_ai_error()`. The connection test uses `resilient=False` to fail
  fast. Don't unwrap these without a plan for rate limits.
- **tiptap v3**: StarterKit is one configurable class (no task lists — add
  `TaskList`/`TaskItem` from `@tiptap/extension-list`); markdown storage via
  `tiptap-markdown`; `editor.storage.markdown.getMarkdown()` needs a cast.
- **chrono-node 2.x**: `result.date()` is a method; `forwardDate` is the third
  `parse()` argument; past bare times and past weekdays do not roll forward —
  `lib/parsing.ts` compensates; its tests lock this in.
- **shadcn v4 uses Base UI, not Radix**: triggers take `render={<Button/>}`
  instead of `asChild`; checked state is `data-checked`. Badges are
  `whitespace-nowrap` by default — a long badge inside a narrow card forces
  horizontal overflow; wrap rows and clip `overflow-x-hidden` on section
  containers.
- **Scroll layout**: the app shell is `h-dvh overflow-hidden`. Each section
  `<main>` MUST own the scroll (`flex-1 min-h-0 overflow-y-auto
  overflow-x-hidden`) with the centered column as an inner div, so the
  scrollbar sits at the window edge.
- **sqlite-vec + aiosqlite**: load the extension in the connect event via
  `dbapi_connection.driver_connection` + `dbapi_connection.await_(...)`
  (`db.py`). KNN queries MUST filter `distance <= 1.0` or tiny indexes match
  everything. FTS5 user input MUST pass through `_fts_query()`.
- **Journal days routes are order-sensitive**: static routes (`/days`) MUST be
  declared before `/{day}`.
- **A field named `date`** cannot be annotated with the type `date` in the same
  class (pydantic resolves the annotation to the FieldInfo). Import as
  `from datetime import date as Date`.
- **SQLModel `Field`** does not accept `pattern`; use `Annotated[str,
  StringConstraints(...)]`.

## Testing

- Backend tests run in-memory (`sqlite+aiosqlite:///:memory:` + StaticPool via
  the `client` fixture in `tests/conftest.py`); no file DB is touched.
- Agent tests MUST NOT hit the network: monkeypatch the runner functions in
  `app/agents.py`, or pass pydantic-ai's `TestModel`. The semantic-search tests
  stub `embed_texts` — never initialize the real fastembed model in tests.
- The Tauri Rust shell cannot compile in this environment. Review
  `frontend/src-tauri/src/lib.rs` against the published plugin APIs instead.

## Known deferred work

- `recurrence_rule` RRULE subset only (DAILY/WEEKLY/INTERVAL/BYDAY).
- Timezone-aware scheduling (currently naive-UTC; display converts client-side).
- Tauri build never compiled (no toolchain); `cargo check` is the first step.
- Reorder endpoint reindexes without clamping to siblings outside the payload.
- `tauri.conf.json` CSP is `null`; a strict CSP is a future hardening step.
