# Journal Backend

Local-first FastAPI + SQLite backend for the task/journal/AI life-OS (see `../plan.md`).

## Setup

```bash
cd backend
uv sync                 # creates .venv from pyproject.toml + uv.lock
cp .env.example .env    # optional; defaults target local Ollama
```

## Run

```bash
uv run uvicorn app.main:app --reload
# API docs: http://127.0.0.1:8000/docs
```

## Test

```bash
uv run pytest
```

## Conventions

- **All datetimes are UTC, naive** (no `tzinfo` in JSON). The client converts to local time for display. Server normalizes any incoming aware datetime to UTC and strips the offset (the SQLite dialect stores offsets but drops them on read, so aware round-trips would be asymmetric).
- **IDs** are 32-char UUID4 hex strings.
- **`tasks.actual_minutes`** is maintained by the focus-session routes (added on create, subtracted on delete) and can also be set manually via task PATCH.
- **Subtasks are tasks** with `parent_id`; deletion cascades via SQLite FKs (`PRAGMA foreign_keys=ON` per connection, `journal_mode=WAL` on the file DB).

## Scoring (plan §3.4)

Deterministic, computed from live telemetry (`/api/scores/daily/{date}`):

```
score = 0.40*task + 0.35*focus + 0.15*habit + clamp(llm_nudge, ±10)
```

- `task = min(100, done/max(planned,1)*100)` — planned = due that day (incl. overdue, still open) or undated-but-completed that day; canceled never counts.
- `focus = min(100, hours/target*100)` — default target 4h, override with `?target_hours=`.
- `habit = done/scheduled*100` — scheduled = `daily` habits existing by that day.

A component the user has not opted into is **neutral (100), not punitive**: no habits configured → habit 100; `target_hours=0` → focus 100. Weights sum to 0.90; the remaining 10 points come from the (Phase 4) LLM nudge. The endpoint is live-only for now — `daily_scores` persistence happens with the daily agent.

## AI provider config (plan §3.2)

`AISettings` reads `AI_PROVIDER`, `AI_MODEL_NAME`, `AI_BASE_URL`, `AI_API_KEY` from the env/.env. Fields can be overridden at runtime (frontend settings drawer) via `app_settings` rows through the API:

- `GET /api/settings/ai` — effective config; returns `api_key_set`, never the key itself
- `PUT /api/settings/ai` — set overrides (`""` clears one back to the env default)
- `DELETE /api/settings/ai` — drop all overrides

`app.ai_factory.create_agent_model()` builds a pydantic-ai model for any OpenAI-compatible endpoint or Anthropic. Note: the plan's §7.1 snippet targets pydantic-ai 0.x; the installed v2 API is used instead (`OpenAIChatModel` + provider objects, `output_type=` on agents).

## API surface (Phase 1)

- `GET /api/health`
- `/api/lists` — CRUD
- `/api/tasks` — CRUD + filters (`list_id`, `parent_id`, `top_level`, `status`, `tag`, `due_before/after`, `overdue`), `GET /{id}/children`, `POST /reorder`
- `/api/focus` — `sessions` (list/create/delete, filters `task_id`, `on_date`), `summary?on_date=`
- `/api/habits` — CRUD, `GET /logs` (by day or range), `PUT /{id}/logs` upsert
- `/api/scores/daily/{date}`
- `/api/settings/ai`

## Known limitations / deferred

- Timezone-aware scheduling (store local + convert) is deferred until the frontend lands; naive-UTC is the interim contract.
- `recurrence_rule` is stored but not expanded yet (needs an RRULE expansion pass in the task UI, Phase 2).
- Journal routes (TipTap content, mood/energy) are Phase 3; the tables already exist.
- `daily_scores`/`weekly_summaries`/`monthly_summaries` are written by the Phase 4 agents; scoring is live-computed until then.
