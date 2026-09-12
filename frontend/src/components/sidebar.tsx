import { useMemo, useState } from "react"
import { BookOpen, Brain, CalendarClock, CalendarDays, CheckCircle2, Inbox, ListTodo, Plus, Settings, TrendingUp, X } from "lucide-react"
import { useUi, type SmartView } from "@/stores/ui"
import { useCreateList, useDeleteList, useHealth, useLists, useTasks } from "@/hooks/api"
import { groupOf } from "@/lib/dates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"

const SMART_VIEWS: { id: SmartView; label: string; icon: typeof Inbox }[] = [
  { id: "today", label: "Today", icon: CalendarDays },
  { id: "overdue", label: "Overdue", icon: CalendarClock },
  { id: "upcoming", label: "Upcoming", icon: ListTodo },
  { id: "all", label: "All tasks", icon: Inbox },
  { id: "completed", label: "Completed", icon: CheckCircle2 },
]

function ScopeButton({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  count?: number
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
        active ? "bg-primary/15 text-foreground ring-1 ring-primary/30" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
      {count !== undefined && count > 0 && <span className="ml-auto text-xs opacity-70">{count}</span>}
    </button>
  )
}

function NewListButton() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const createList = useCreateList()

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        <Plus className="size-4" /> New list
      </button>
    )
  }

  return (
    <Input
      autoFocus
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && name.trim()) {
          createList.mutate({ name: name.trim() })
          setName("")
          setOpen(false)
        }
        if (e.key === "Escape") setOpen(false)
      }}
      placeholder="List name…"
      className="h-8 text-sm"
    />
  )
}

function ListRow({ id, name, color, count }: { id: string; name: string; color: string; count: number }) {
  const section = useUi((s) => s.section)
  const scope = useUi((s) => s.scope)
  const setScope = useUi((s) => s.setScope)
  const deleteList = useDeleteList()
  return (
    <div className="group relative">
      <ScopeButton
        active={section === "tasks" && scope.kind === "list" && scope.id === id}
        onClick={() => setScope({ kind: "list", id })}
        count={count}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate">{name}</span>
      </ScopeButton>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Delete list "${name}"`}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
              onClick={() => deleteList.mutate(id)}
            />
          }
        >
          <X className="text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>Delete list (tasks are kept)</TooltipContent>
      </Tooltip>
    </div>
  )
}

export function Sidebar() {
  const section = useUi((s) => s.section)
  const setSection = useUi((s) => s.setSection)
  const scope = useUi((s) => s.scope)
  const setScope = useUi((s) => s.setScope)
  const lists = useLists()
  const tasks = useTasks()
  const health = useHealth()

  const counts = useMemo(() => {
    const all = tasks.data ?? []
    const open = all.filter((t) => t.status !== "completed" && t.status !== "canceled")
    return {
      smart: {
        today: open.filter((t) => ["overdue", "today"].includes(groupOf(t))).length,
        overdue: open.filter((t) => groupOf(t) === "overdue").length,
        upcoming: open.filter((t) => ["tomorrow", "upcoming"].includes(groupOf(t))).length,
        all: open.length,
        completed: all.filter((t) => t.status === "completed").length,
      } as Record<SmartView, number>,
      lists: open.reduce<Map<string, number>>((acc, t) => {
        if (t.list_id) acc.set(t.list_id, (acc.get(t.list_id) ?? 0) + 1)
        return acc
      }, new Map()),
    }
  }, [tasks.data])

  return (
    <aside className="glass flex w-60 shrink-0 flex-col gap-4 border-r-[var(--glass-border)] p-3">
      <div className="flex items-center gap-2 px-2 pt-2">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary/20 text-primary ring-1 ring-primary/40">
          <ListTodo className="size-4" />
        </div>
        <span className="font-semibold">Journal</span>
        <span
          className={cn(
            "ml-auto size-2 rounded-full transition-colors",
            health.isError ? "bg-destructive" : health.isLoading ? "bg-medium animate-pulse" : "bg-positive",
          )}
          role="status"
          aria-label={health.isError ? "API unreachable" : health.isLoading ? "Connecting to API" : "API connected"}
          title={health.isError ? "API unreachable" : "API connected"}
        />
      </div>

      <nav className="space-y-0.5">
        <ScopeButton active={section === "journal"} onClick={() => setSection("journal")}>
          <BookOpen className="size-4 shrink-0" />
          Journal
        </ScopeButton>
        <ScopeButton active={section === "second_brain"} onClick={() => setSection("second_brain")}>
          <Brain className="size-4 shrink-0" />
          Second brain
        </ScopeButton>
        <ScopeButton active={section === "insights"} onClick={() => setSection("insights")}>
          <TrendingUp className="size-4 shrink-0" />
          Insights
        </ScopeButton>
        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-widest text-muted-foreground/70 uppercase">
          Tasks
        </div>
        {SMART_VIEWS.map(({ id, label, icon: Icon }) => (
          <ScopeButton
            key={id}
            active={section === "tasks" && scope.kind === "smart" && scope.id === id}
            onClick={() => setScope({ kind: "smart", id })}
            count={counts.smart[id]}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </ScopeButton>
        ))}
      </nav>

      <Separator className="opacity-50" />
      <ScopeButton active={section === "settings"} onClick={() => setSection("settings")}>
        <Settings className="size-4 shrink-0" />
        Settings
      </ScopeButton>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Lists
        </div>
        <div className="space-y-0.5">
          {lists.isLoading
            ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)
            : (lists.data ?? []).map((l) => (
                <ListRow
                  key={l.id}
                  id={l.id}
                  name={l.name}
                  color={l.color}
                  count={counts.lists.get(l.id) ?? 0}
                />
              ))}
        </div>
        <div className="pt-1">
          <NewListButton />
        </div>
      </div>
    </aside>
  )
}
