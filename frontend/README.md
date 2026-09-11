# Journal Frontend

React 19 + Vite + Tailwind v4 + shadcn/ui (Base UI) frontend for the Journal life-OS.

## Run

```bash
npm install
npm run dev        # http://localhost:5173, expects backend on :8000 (see ../backend)
```

## Test & build

```bash
npm run test       # vitest (quick-add parser, date helpers)
npm run build      # tsc -b + vite build
```

## Phase 2 scope

- **Quick add** (`src/lib/parsing.ts`): `buy milk tomorrow 5pm !1 #personal @errands ~10m` —
  chrono-node dates (auto-roll-forward for bare past times/weekdays), `!1/!2/!3` priority,
  `#list` (auto-created if missing), `@tags`, `~durations`, `every mon, wed` → RRULE.
  Live parse preview under the input; `?` popover documents the syntax.
- **List view** (`src/components/task-sections.tsx`): sections Overdue / Today / Tomorrow /
  Upcoming / No date / Completed, scoped to smart views or a list; search filter;
  inline rename (double-click), subtasks (expand + add), per-task menu (priority, due, move, delete).
- **Board view** (`src/components/kanban-board.tsx`): @dnd-kit Kanban across
  To Do / In Progress / Done with drag overlay and fractional `order_index` writes.
- **Optimistic updates** (`src/hooks/api.ts`): all mutations patch the TanStack Query cache
  on `onMutate` and roll back on error — check-offs and captures feel instant.

## Conventions

- All datetimes arrive naive UTC from the API and are parsed with `parseUTC()`
  (appends `Z`); outgoing datetimes are aware ISO (`toISOString()`), which the
  backend normalizes.
- Single tasks cache (`["tasks"]`) — grouping/filtering happens client-side;
  mutations invalidate after settle.
- UI state (view, scope) persists to localStorage via zustand `persist`.
- shadcn v4 on this project uses **Base UI** primitives (`@base-ui/react`), not Radix:
  triggers take a `render={<Element />}` prop instead of Radix's `asChild`.
