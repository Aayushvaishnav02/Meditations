# Architecture & Implementation Plan: Modern Todo, Journaling & AI Life-Operating System

---

## 1. Executive Summary & Product Vision

This project is a modern, unified personal operating system combining:
1. **TickTick-grade Task Management**: Fast natural language capture, hierarchical subtasks, priority matrices, tags/lists, focus/Pomodoro tracking, and fluid Kanban/Calendar views.
2. **Reflective Long-Form Journaling**: TipTap-based rich block/markdown editor with automated daily activity embeds (tasks finished, focus hours logged, habits kept) and quantified mood/energy tracking.
3. **Hierarchical AI Agent System**: A proactive "Life Coach & Chief of Staff" agent that solves the LLM memory blowup problem via **hierarchical compaction**, scores daily performance objectively with deterministic math + qualitative feedback, breaks down complex tasks, and offers conversational capture and semantic search over historical entries.

### Core Philosophy
* **Frictionless Capture**: Task input must take under 3 seconds using inline shorthand (`buy milk tomorrow 5pm !1 #personal`).
* **Bounded Context Memory ($O(1)$ Token Growth)**: Raw journal entries are never re-read forever. Older days collapse into weekly summaries; weeks collapse into monthly reviews. The agent's token budget remains constant whether on Day 10 or Year 5.
* **Deterministic Scoring Over Hallucinated Scores**: Productivity scores are calculated mathematically from structured telemetry (completion rate, deep-work hours, streak multipliers), while the LLM acts as an analytical mentor providing qualitative feedback and trend diagnosis.
* **Local-First & Privacy-Focused**: Powered by SQLite (WAL mode) with optional local vector embeddings and local LLM support (Ollama), running seamlessly on EndeavourOS / Linux with minimal resource footprint.

---

## 2. Recommended Modern Tech Stack

### 2.1 Technology Matrix

| Layer | Recommended Choice | Rationale & Alternatives Considered |
|---|---|---|
| **Frontend Framework** | **React 19 + Vite** (or **Next.js 15 App Router**) + **Tauri v2** | Blazing fast development, minimal memory (~40MB RAM under Tauri vs 400MB+ under Electron). Tauri v2 allows native desktop global shortcuts (e.g., `Super+Shift+A` for instant quick-add) and system tray integration on Linux. |
| **Styling & UI Kit** | **Tailwind CSS v4** + **shadcn/ui** (Radix UI) + **Framer Motion** | Dark glass aesthetic, keyboard-accessible primitives, zero runtime CSS bloat, and fluid micro-interactions (strikethroughs, drag handles, modal drawers). |
| **Rich-Text Editor** | **TipTap v2** (ProseMirror wrapper) | Industry standard for Notion/TickTick-like editors. Extensible for slash commands (`/task`, `/callout`), markdown shortcuts, task list checkboxes, and inline AI completion. |
| **Date & Syntax NLP** | **chrono-node** | Instant client-side natural language date parsing (`tomorrow at 5pm`, `every mon, wed`) without network latency. |
| **Drag & Drop** | **@dnd-kit/core** + **@dnd-kit/sortable** | Accessible, performant, mobile-friendly drag-and-drop for Kanban boards, Eisenhower matrices, and task reordering. |
| **State & Data Fetching**| **TanStack Query (React Query v5)** + **Zustand** | Optimistic mutations for 0ms task completion latency, offline caching, and lightweight state for timers/filters. |
| **Backend API** | **FastAPI (Python 3.12+)** with `uvicorn` | First-class ecosystem for AI agent orchestration, asynchronous endpoints, Pydantic v2 data validation, and native SQLite integration. |
| **Database** | **SQLite (WAL Mode)** + **SQLModel** (or **SQLAlchemy 2.0 Async**) | Single-file zero-ops database, microsecond queries, ACID compliance, zero maintenance overhead, and privacy-preserving. |
| **Search & Vectors** | **sqlite-vec** + **SQLite FTS5** | Hybrid full-text keyword search (FTS5) plus native vector similarity embeddings (`sqlite-vec`) in the same database without running external Chroma/Qdrant services. |
| **AI Agent Framework** | **PydanticAI** (Primary) + **LiteLLM** | Modern, strictly typed agent framework with type-safe dependency injection, structured tool calls, and model-agnostic switching (Claude, OpenAI, DeepSeek, Groq, or local Ollama). Fully configurable custom `base_url` and `api_key`. |
| **Local Model / Offline**| **Ollama** (`llama3.2:3b` / `qwen2.5:7b`) + **fastembed** | Zero-cost local inference via OpenAI-compatible `base_url` (`http://localhost:11434/v1`), offline tagging, and on-device text embeddings (`bge-small-en-v1.5`). |
| **System Orchestration**| **Linux systemd timers** & services | Native EndeavourOS process execution for reliable daily, weekly, and monthly rollup jobs without persistent Python daemon overhead. |

---

## 3. AI Agent Architecture: Deep Dive

### 3.1 Why PydanticAI?
For modern Python-based AI agents, **PydanticAI** (created by the Pydantic team) is the top choice over legacy LangChain:
1. **Type-Safe Structured Output**: Validates all agent responses directly into Pydantic models with automated retry loops if schemas fail.
2. **Model Agnostic**: Seamlessly switches between Anthropic (Claude 3.5 Sonnet / Haiku), OpenAI (GPT-4o), Groq, and local models (Ollama).
3. **Dependency Injection**: Pass database sessions, user preferences, and configuration directly into tool functions without global state.
4. **Clean & Lightweight**: Minimal abstractions, transparent prompt chains, and pure Pythonic async execution.

### 3.2 Provider Agility: Configurable `base_url` and `api_key`
A key requirement is total freedom of model backend. You shouldn't be locked into a single cloud vendor. The agent system supports:
1. **Custom `base_url`**:
   - **Local Ollama**: `http://localhost:11434/v1` (run models like `llama3.2:3b`, `qwen2.5:7b` completely offline and private for free).
   - **OpenRouter**: `https://openrouter.ai/api/v1` (access hundreds of models with a single unified key).
   - **Groq / Together / DeepSeek / Mistral / vLLM**: Any OpenAI-compatible endpoint.
   - **Official OpenAI / Anthropic**: Native default base URLs.
2. **Dynamic API Key Management**:
   - Primary: `.env` environment variables (`AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL_NAME`).
   - App Settings: An optional `app_settings` table in SQLite so keys and endpoints can be updated directly from the frontend UI settings drawer without restarting backend services.
3. **PydanticAI Dynamic Model Loader**:
   - Supports instantiating `OpenAIModel` with custom `base_url` and `api_key`, or `AnthropicModel`, or fallbacks with automatic failover.

### 3.3 The Hierarchical Compaction Engine

The core problem of AI journaling is context bloat. As time progresses, feeding hundreds of raw daily entries into an LLM exceeds context limits and increases costs. 

```
[ Day 1 .. Day 7 Raw Entries ] ──► Daily Agent (Reads today + last 6d + last week summary)
             │
             ▼ (End of Week Cron)
  [ Weekly Summary Compacted ] ──► Weekly Agent (Reads 7 daily scores + last 4 weekly summaries)
             │
             ▼ (End of Month Cron)
 [ Monthly Review Compacted ]  ──► Monthly Agent (Reads 4 weekly summaries + last 3 monthly summaries)
```

#### Bounded Input Constraints:
* **Daily Agent Run** (Triggered nightly or upon saving journal entry):
  * Inputs: Today's raw text + deterministic metrics + past 6 days' raw text + latest 1 weekly summary + latest 1 monthly summary.
  * Maximum token footprint: ~4,000 tokens ($O(1)$).
  * Output: Qualitative feedback, identified cognitive blindspots, suggested wins/misses, and nudges.
* **Weekly Agent Run** (Triggered Sunday 23:59 via systemd):
  * Inputs: 7 daily scores & structured metadata (tasks done, deep-work hours) + last 4 weekly summaries + latest monthly summary. **Raw daily journal text is never read again.**
  * Output: Week rollup (average score, primary wins, friction points, carried-over habits).
* **Monthly Agent Run** (Triggered last day of month via systemd):
  * Inputs: 4–5 weekly summaries from the current month + last 2–3 monthly summaries.
  * Output: High-level narrative, macro productivity trends, personal growth insights.

### 3.4 Deterministic Hybrid Scoring Formula

To prevent LLM "score drift" (where a score of 75 on Day 1 means something completely different on Day 60), the quantitative score is computed deterministically in Python:

$$\text{Daily Score} = (W_{\text{task}} \times S_{\text{task}}) + (W_{\text{focus}} \times S_{\text{focus}}) + (W_{\text{habit}} \times S_{\text{habit}}) + \Delta_{\text{LLM}}$$

Where:
* $S_{\text{task}} = \min(100, \frac{\text{tasks\_completed}}{\max(\text{tasks\_planned}, 1)} \times 100)$ (Weight: 40%)
* $S_{\text{focus}} = \min(100, \frac{\text{hours\_deep\_work}}{\text{target\_hours}} \times 100)$ (Weight: 35%)
* $S_{\text{habit}} = \frac{\text{habits\_done}}{\text{habits\_scheduled}} \times 100$ (Weight: 15%)
* $\Delta_{\text{LLM}} \in [-10, +10]$: A bounded qualitative adjustment given by the LLM with an explicit documented justification (e.g., handled an unexpected high-stress emergency well, or procrastinated despite empty calendar).

---

## 4. System Architecture & Component Design

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Vite / Tauri v2)                      │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │   Quick Add Bar       │  │  TipTap Editor  │  │  Views:          │  │
│  │   (chrono-node NLP,   │  │  (Daily Notes,  │  │  • Kanban Board │  │
│  │   !priority, #tags)   │  │  Auto-Embeds)   │  │  • Calendar/Time │  │
│  └───────────────────────┘  └─────────────────┘  │  • Habit Grid    │  │
│  ┌────────────────────────────────────────────┐  └──────────────────┘  │
│  │     Zustand Store + TanStack Query         │                        │
│  │     (Optimistic UI updates, Pomodoro clock)│                        │
│  └────────────────────────────────────────────┘                        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / REST / WebSocket
┌───────────────────────────────────▼────────────────────────────────────┐
│                        BACKEND (FastAPI API)                           │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ Task & Habit Routes   │  │ Journal Routes  │  │ Focus Timer API  │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                   AI Agent Module (PydanticAI)                   │  │
│  │   • Daily/Weekly Compactor   • Natural Language Task Extractor   │  │
│  │   • Task Decomposition Agent • Hybrid RAG (sqlite-vec + FTS5)    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │ SQLModel / SQLite Engine        │
┌──────────────────▼─────────────────────────────────▼───────────────────┐
│                     STORAGE & SYSTEM ORCHESTRATION                     │
│                                                                        │
│  SQLite DB (WAL Mode):                                                 │
│  • tasks, subtasks, habits, focus_sessions                             │
│  • entries, daily_scores, weekly_summaries, monthly_summaries           │
│  • virtual tables: fts_entries (FTS5), vec_entries (sqlite-vec)        │
│                                                                        │
│  systemd Timers (EndeavourOS):                                         │
│  • journal-daily.timer   ──► POST /api/agents/rollup/daily             │
│  • journal-weekly.timer  ──► POST /api/agents/rollup/weekly            │
│  • journal-monthly.timer ──► POST /api/agents/rollup/monthly           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Database Schema Specification (SQLite)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 1. Lists & Projects
CREATE TABLE lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#64748b',
    icon TEXT,
    is_favorite BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tasks & Subtasks
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    list_id TEXT REFERENCES lists(id) ON DELETE SET NULL,
    parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    priority INTEGER DEFAULT 0, -- 0: None, 1: Low (!3), 2: Med (!2), 3: High (!1)
    status TEXT DEFAULT 'todo', -- 'todo', 'in_progress', 'completed', 'canceled'
    due_date DATETIME,
    estimated_minutes INTEGER,
    actual_minutes INTEGER DEFAULT 0,
    recurrence_rule TEXT, -- e.g. 'FREQ=DAILY;INTERVAL=1' or 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'
    tags TEXT, -- JSON array of tags: ["work", "dev"]
    order_index REAL NOT NULL DEFAULT 0.0,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Focus / Pomodoro Sessions
CREATE TABLE focus_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    duration_minutes INTEGER NOT NULL,
    session_type TEXT DEFAULT 'pomodoro', -- 'pomodoro', 'stopwatch'
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Habits & Logs
CREATE TABLE habits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    target_frequency TEXT DEFAULT 'daily', -- 'daily', 'weekdays', '3x_week'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE habit_logs (
    id TEXT PRIMARY KEY,
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    completed BOOLEAN DEFAULT 1,
    UNIQUE(habit_id, date)
);

-- 5. Journal Entries
CREATE TABLE journal_entries (
    date DATE PRIMARY KEY,
    raw_markdown TEXT NOT NULL,
    mood INTEGER CHECK(mood BETWEEN 1 AND 5),
    energy INTEGER CHECK(energy BETWEEN 1 AND 5),
    hours_deep_work REAL DEFAULT 0.0,
    tasks_planned INTEGER DEFAULT 0,
    tasks_done INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Hierarchical Compactions & Scoring
CREATE TABLE daily_scores (
    date DATE PRIMARY KEY REFERENCES journal_entries(date) ON DELETE CASCADE,
    deterministic_score REAL NOT NULL,
    llm_nudge REAL DEFAULT 0.0,
    final_score REAL NOT NULL,
    rubric_breakdown_json TEXT NOT NULL,
    feedback TEXT NOT NULL,
    insight TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE weekly_summaries (
    week_start DATE PRIMARY KEY,
    avg_score REAL NOT NULL,
    trend TEXT NOT NULL, -- 'rising', 'declining', 'stable'
    wins TEXT NOT NULL,
    misses TEXT NOT NULL,
    carried_action_items TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE monthly_summaries (
    month TEXT PRIMARY KEY, -- 'YYYY-MM'
    avg_score REAL NOT NULL,
    trend TEXT NOT NULL,
    narrative TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 6. Detailed Feature Specifications

### 6.1 Feature Module 1: The TickTick-Grade Task Engine
1. **Quick-Add Parsing Bar**:
   - Parses date, time, recurring patterns, tags, priority, and target list simultaneously.
   - Example syntax: `Review Q3 budget tomorrow 3pm !1 #finance @urgent ~45m`
   - Parsed entities:
     - Title: `Review Q3 budget`
     - Due: Tomorrow at 15:00
     - Priority: High (`!1`)
     - List: `finance`
     - Tag: `urgent`
     - Estimated duration: 45 minutes
2. **Multi-View Modes**:
   - **List View**: Grouped by Today, Upcoming, Overdue, or custom tag/list.
   - **Kanban Board**: Drag-and-drop between lists or statuses (`To Do`, `In Progress`, `Done`).
   - **Interactive Calendar**: Day and Week time-blocking view. Drag tasks from backlog onto the calendar schedule.
3. **Integrated Focus Engine (Pomodoro & Stopwatch)**:
   - Floating or full-screen focus timer linked to the active task.
   - Automatically writes finished session durations into `focus_sessions` and task `actual_minutes`.

### 6.2 Feature Module 2: The Modern Journaling Engine
1. **TipTap Markdown Block Editor**:
   - Clean typographical hierarchy with Notion-style slash commands (`/h1`, `/task`, `/quote`, `/callout`).
2. **Automated Daily Activity Rollup Embeds**:
   - At the top or bottom of today's journal entry, a one-click button inserts live data:
     - **Tasks Completed Today**: `[x] Submit report`, `[x] Code review`.
     - **Focus Stats**: Total deep-work time (e.g., `3h 45m across 4 sessions`).
     - **Habit Checklist**: Water, Workout, Reading.
3. **Daily Reflection Templates**:
   - Configurable prompts: "What was the main friction point today?", "What is one win to celebrate?", "What should be deprioritized tomorrow?"

### 6.3 Feature Module 3: Proactive AI Agent Features
1. **Hierarchical Summarization & Review Agent**:
   - Evaluates daily balance, detects habit degradation early, and produces actionable insights.
2. **Smart Task Decomposition Agent**:
   - User inputs: `Plan product launch`.
   - Agent outputs structured subtasks with estimated times and priority suggestions.
3. **Conversational Daily Planning Briefing**:
   - Every morning, agent reviews overdue tasks, today's calendar, and yesterday's reflection to recommend an achievable Top 3 Priority Focus.
4. **Natural Language Omnibar & Conversational Capture**:
   - Dictate or paste unstructured text: *"Spoke with Alex. Need to email him the slide deck by Thursday 4pm and schedule team sync for Monday."*
   - Agent creates the journal note snippet and registers two tasks with explicit due dates.
5. **Ask My Second Brain (Hybrid Search)**:
   - Ask questions like: *"When did I start feeling burned out on the backend refactor and what caused it?"*
   - Queries `sqlite-vec` embeddings and `fts_entries` to cite past journal entries and weekly rollups.

---

## 7. AI Implementation Blueprint with PydanticAI

### 7.1 Model Factory: Dynamic Base URL & API Key Configuration

The AI subsystem allows switching providers on the fly (cloud Claude/OpenAI, OpenRouter, or local Ollama) by configuring `base_url` and `api_key` via environment variables (`.env`) or database settings.

```python
from typing import Optional
from pydantic_settings import BaseSettings
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.providers.openai import OpenAIProvider

class AISettings(BaseSettings):
    AI_PROVIDER: str = "openai_compatible"  # "openai_compatible" or "anthropic"
    AI_MODEL_NAME: str = "llama3.2:3b"     # e.g., "llama3.2:3b", "gpt-4o-mini", "claude-3-5-sonnet-latest"
    AI_BASE_URL: Optional[str] = "http://localhost:11434/v1"  # Custom endpoint (Ollama, OpenRouter, Groq, vLLM)
    AI_API_KEY: Optional[str] = "ollama"   # API key (sk-... or dummy string for local Ollama)

    class Config:
        env_file = ".env"
        extra = "ignore"

def create_agent_model(settings: Optional[AISettings] = None):
    """Instantiates a model client with configurable base_url and api_key."""
    s = settings or AISettings()
    
    if s.AI_PROVIDER == "anthropic":
        return AnthropicModel(
            model_name=s.AI_MODEL_NAME,
            api_key=s.AI_API_KEY,
            base_url=s.AI_BASE_URL  # Supports Anthropic reverse proxies if provided
        )
    else:
        # Generic OpenAI-compatible provider: works with Ollama, OpenRouter, Groq, DeepSeek, LocalAI
        return OpenAIModel(
            model_name=s.AI_MODEL_NAME,
            provider=OpenAIProvider(
                base_url=s.AI_BASE_URL or "https://api.openai.com/v1",
                api_key=s.AI_API_KEY or "not-needed"
            )
        )
```

### 7.2 Daily Review & Scoring Agent Example

```python
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from typing import List, Optional
from dataclasses import dataclass
import datetime

# 1. Output Schemas
class RubricBreakdown(BaseModel):
    task_completion_rate: float = Field(description="Tasks completed / planned (0.0 to 1.0)")
    deep_work_hours: float = Field(description="Actual deep work hours logged")
    habit_consistency: float = Field(description="Habits completed / scheduled (0.0 to 1.0)")

class DailyReviewOutput(BaseModel):
    llm_nudge: float = Field(description="Score modifier from -10.0 to +10.0 based on subjective context", ge=-10.0, le=10.0)
    nudge_rationale: str = Field(description="Explanation for the score adjustment")
    feedback: str = Field(description="Direct, constructive feedback on the day's execution")
    key_insight: str = Field(description="One high-leverage observation or behavioral pattern identified")
    suggested_action_for_tomorrow: str = Field(description="Single most important recommendation for next day")

# 2. Agent Dependencies
@dataclass
class AgentDeps:
    today_raw_text: str
    past_6d_entries: List[dict]
    latest_weekly_summary: Optional[str]
    latest_monthly_summary: Optional[str]
    deterministic_metrics: dict

# 3. Agent Definition using dynamic model factory
model = create_agent_model()
daily_agent = Agent(
    model,
    deps_type=AgentDeps,
    result_type=DailyReviewOutput,
    system_prompt=(
        "You are an executive personal coach and productivity analyst. "
        "You analyze daily journal entries, task telemetry, and recent historical summaries. "
        "Your role is not to flatter, but to provide rigorous, actionable, empathetic analysis. "
        "You will receive computed deterministic metrics (task rate, focus hours). "
        "You may adjust the score with an LLM nudge between -10 and +10 with an explicit reason."
    )
)

@daily_agent.system_prompt
def build_context(ctx: RunContext[AgentDeps]) -> str:
    return f"""
    --- CONTEXT (BOUNDED MEMORY) ---
    Monthly Context: {ctx.deps.latest_monthly_summary or 'No prior month recorded.'}
    Weekly Context: {ctx.deps.latest_weekly_summary or 'No prior week recorded.'}
    Past 6 Days Scores & Notes: {ctx.deps.past_6d_entries}
    Deterministic Metrics Today: {ctx.deps.deterministic_metrics}
    
    Today's Raw Entry:
    \"\"\"{ctx.deps.today_raw_text}\"\"\"
    """
```

### 7.3 Task Decomposition Tool Example

```python
class SubtaskItem(BaseModel):
    title: str
    estimated_minutes: int
    priority: int = Field(ge=0, le=3)

class DecompositionPlan(BaseModel):
    task_breakdown: List[SubtaskItem]
    advice: str

breakdown_agent = Agent(
    'anthropic:claude-3-5-haiku-latest',
    result_type=DecompositionPlan,
    system_prompt="Decompose complex user goals into atomic, actionable steps (20-45 minutes each)."
)
```

---

## 8. Implementation Roadmap

### Phase 1: Foundation & Data Layer (Days 1–3) — `feat/backend-data-layer` ✅ (implemented on branch `feat/backend-data-layer`)
- [x] Initialize Git repo, `.gitignore`, and Python virtual environment with `uv`.
- [x] Implement SQLite schema with SQLModel / SQLAlchemy 2.0.
- [x] Build core CRUD endpoints in FastAPI for tasks, subtasks, lists, and focus sessions.
- [x] Implement deterministic scoring calculation utility.
- [x] Configure `AISettings` supporting custom `base_url` and `api_key`.

### Phase 2: Core Task UI & Natural Language Capture (Days 4–7) — `feat/task-engine-ui` ✅ (implemented on branch `feat/task-engine-ui`)
- [x] Set up Vite + React 19 + Tailwind CSS v4 + shadcn/ui.
- [x] Build Quick Add Bar with `chrono-node` for real-time natural language date/priority/tag parsing.
- [x] Implement Task List and Kanban Board views using `@dnd-kit`.
- [x] Wire TanStack Query with optimistic updates for instant check-offs.

### Phase 3: Focus Timer & TipTap Journaling (Days 8–11) — `feat/focus-tiptap-journal` ✅ (implemented on branch `feat/focus-tiptap-journal`)
- [x] Build Pomodoro / Stopwatch focus tracker with Zustand state.
- [x] Implement TipTap rich-text editor for daily journal entries.
- [x] Build "Insert Daily Activity" component to embed completed tasks and focus metrics into journal notes.
- [x] Store mood/energy ratings.

### Phase 4: AI Hierarchical Compaction & Agent Workflows (Days 12–15) — `feat/ai-compaction-agents` ✅ (implemented on branch `feat/ai-compaction-agents`)
- [x] Implement PydanticAI agents (`daily_agent`, `weekly_agent`, `monthly_agent`).
- [x] Build dynamic provider switcher supporting local Ollama (`http://localhost:11434/v1`), OpenRouter, Groq, and Claude.
- [x] Build task decomposition agent and conversational omnibar capture.
- [x] Set up systemd `.service` and `.timer` files for automated nightly, weekly, and monthly compactions.

### Phase 5: Search, Polish & Desktop Packaging (Days 16–18) — `feat/rag-desktop-polish`
- [ ] Integrate `sqlite-vec` or `fastembed` for hybrid semantic and keyword search.
- [ ] Wrap frontend in **Tauri v2** for lightweight Linux desktop tray and system-wide hotkeys.
- [ ] Implement dark-mode glass styling and fluid Framer Motion transitions.

---

## 9. Recommended Development Commands & Dependencies

### Backend (`requirements.txt` / `pyproject.toml`)
```toml
[project]
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "sqlmodel>=0.0.22",
    "pydantic>=2.9.0",
    "pydantic-ai>=0.0.14",
    "sqlite-vec>=0.1.1",
    "litellm>=1.49.0",
    "fastembed>=0.3.0",
    "python-multipart>=0.0.9"
]
```

### Frontend (`package.json`)
```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tanstack/react-query": "^5.59.0",
    "zustand": "^5.0.0",
    "@tiptap/react": "^2.8.0",
    "@tiptap/starter-kit": "^2.8.0",
    "@tiptap/extension-task-list": "^2.8.0",
    "@tiptap/extension-task-item": "^2.8.0",
    "@dnd-kit/core": "^6.1.0",
    "@dnd-kit/sortable": "^8.0.0",
    "chrono-node": "^2.7.5",
    "lucide-react": "^0.453.0",
    "framer-motion": "^11.11.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.4"
  }
}
```

---

## 10. Git Workflow, Branching Strategy & Project Hygiene

To ensure clean development, isolation of complex AI/frontend features, and easy rollback, the project enforces a strict Git branching workflow.

### 10.1 Branch Structure

* **`main`**: The single source of truth. Always deployable and buildable. Direct commits to `main` are prohibited except for initial project bootstrap and docs.
* **`feat/<feature-name>`**: Dedicated branch for every feature or architectural phase.
  * `feat/backend-data-layer`: FastAPI models, SQLite schema, CRUD routes.
  * `feat/task-engine-ui`: Quick-add bar, task list, Kanban views, optimistic UI.
  * `feat/focus-tiptap-journal`: TipTap block editor, daily activity embeds, focus clock.
  * `feat/ai-compaction-agents`: Daily, weekly, monthly PydanticAI rollups & systemd timers.
  * `feat/ai-provider-config`: UI & API settings for custom `base_url` and `api_key`.
  * `feat/rag-desktop-polish`: sqlite-vec search, Tauri v2 desktop integration.
* **`fix/<bug-name>`**: Targeted fixes for unexpected behavior or edge-case regressions.
* **`refactor/<component>`**: Non-functional refactoring or performance optimization.

### 10.2 Feature Branch Lifecycle Workflow

For every new feature, follow this standard cycle:

```bash
# 1. Ensure main is clean and up to date
git checkout main
git pull origin main

# 2. Branch off into an isolated feature branch
git checkout -b feat/task-engine-ui

# 3. Work incrementally with atomic, descriptive Conventional Commits
git add <files>
git commit -m "feat(tasks): add chrono-node inline NLP parsing to quick-add bar"

# 4. Run tests and linting before merge
pytest tests/
npm run lint

# 5. Merge feature back into main (using --no-ff or PR to preserve history)
git checkout main
git merge --no-ff feat/task-engine-ui -m "merge: feat/task-engine-ui into main"

# 6. Clean up the merged branch
git branch -d feat/task-engine-ui
```

### 10.3 Commit Message Convention (Conventional Commits)

Use single-line, standardized commit messages:
* `feat(scope): add new feature` (e.g., `feat(ai): support custom base_url for Ollama`)
* `fix(scope): fix bug or calculation error` (e.g., `fix(scoring): prevent division by zero when planned tasks is 0`)
* `refactor(scope): internal restructuring without changing behavior` (e.g., `refactor(db): extract session dependency into separate module`)
* `docs(scope): update documentation or plans` (e.g., `docs(plan): update agent base_url architecture`)
* `chore(scope): build, dependency or tooling changes` (e.g., `chore(deps): bump pydantic-ai to latest version`)

### 10.4 Repository Hygiene & `.gitignore` Blueprint

Create a root `.gitignore` from day one to guarantee secrets, local databases, and temporary files never touch version control:

```gitignore
# Python & Virtual Environments
__pycache__/
*.py[cod]
*$py.class
.venv/
env/
build/
dist/
*.egg-info/

# SQLite & Data Stores
*.db
*.sqlite
*.sqlite3
data/
*.wal

# Node & Frontend
node_modules/
.next/
dist/
.vite/
npm-debug.log*

# Tauri & Native Build Artifacts
src-tauri/target/

# Environment Variables & Secrets (CRITICAL)
.env
.env.local
.env.*.local
*.pem
*.key

# OS & IDE Metadata
.DS_Store
Thumbs.db
.idea/
.vscode/
*.swp
*.swo
```

