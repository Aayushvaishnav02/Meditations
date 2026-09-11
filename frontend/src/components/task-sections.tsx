import { useMemo } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Inbox, PartyPopper } from "lucide-react"
import type { Task, TaskList } from "@/api/types"
import { GROUP_LABELS, groupOf, sortTasks, type TaskGroup } from "@/lib/dates"
import type { SmartView } from "@/stores/ui"
import { TaskItem } from "@/components/task-item"

const SECTIONS_BY_SCOPE: Record<SmartView | "list", TaskGroup[]> = {
  today: ["overdue", "today"],
  overdue: ["overdue"],
  upcoming: ["tomorrow", "upcoming"],
  all: ["overdue", "today", "tomorrow", "upcoming", "nodate"],
  completed: ["completed"],
  list: ["overdue", "today", "tomorrow", "upcoming", "nodate"],
}

const EMPTY_MESSAGES: Record<string, string> = {
  today: "Nothing due today. Enjoy the calm.",
  overdue: "No overdue tasks. Clean slate.",
  upcoming: "The future is clear.",
  all: "No tasks yet. Capture your first one above.",
  completed: "Nothing completed yet.",
  list: "This list is empty.",
}

function matchSearch(task: Task, search: string): boolean {
  if (!search) return true
  const q = search.toLowerCase()
  return task.title.toLowerCase().includes(q) || task.tags.some((t) => t.toLowerCase().includes(q))
}

export function TaskSections({
  tasks,
  scope,
  search,
  lists,
}: {
  tasks: Task[]
  scope: { kind: "smart"; id: SmartView } | { kind: "list"; id: string }
  search: string
  lists: TaskList[]
}) {
  const { sections, hasAny } = useMemo(() => {
    const scopeFilter = (t: Task) =>
      scope.kind === "list" ? t.list_id === scope.id : true
    const visible = tasks.filter((t) => scopeFilter(t) && matchSearch(t, search))
    const byId = new Map(visible.map((t) => [t.id, t]))

    const grouped = new Map<TaskGroup, Task[]>()
    for (const t of visible) {
      // top-level only in sections; children render nested under their parent
      if (t.parent_id !== null && byId.has(t.parent_id)) continue
      const g = groupOf(t)
      const bucket = grouped.get(g) ?? []
      bucket.push(t)
      grouped.set(g, bucket)
    }
    for (const bucket of grouped.values()) bucket.sort(sortTasks)

    const sections = SECTIONS_BY_SCOPE[scope.kind === "list" ? "list" : scope.id]
      .map((g) => ({ group: g, tasks: grouped.get(g) ?? [] }))
      .filter((s) => s.tasks.length > 0)

    // cap the completed backlog
    for (const s of sections) {
      if (s.group === "completed") s.tasks = s.tasks.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")).slice(0, 20)
    }

    const hasAny = visible.length > 0
    return { sections, hasAny }
  }, [tasks, scope, search])

  if (!hasAny && !search) {
    return (
      <div className="flex flex-col items-center gap-3 pt-24 text-center text-muted-foreground">
        {scope.kind === "smart" && scope.id === "today" ? (
          <PartyPopper className="size-8 text-primary/70" />
        ) : (
          <Inbox className="size-8 text-muted-foreground/50" />
        )}
        <p className="text-sm">
          {scope.kind === "list" ? EMPTY_MESSAGES.list : EMPTY_MESSAGES[scope.id]}
        </p>
      </div>
    )
  }

  const listBadges = lists.map((l) => ({ id: l.id, name: l.name }))

  return (
    <div className="space-y-6 px-6 pb-24">
      {sections.map((section) => (
        <section key={section.group}>
          <h2 className="mb-1.5 flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {GROUP_LABELS[section.group]}
            <span className="font-normal opacity-60">{section.tasks.length}</span>
          </h2>
          <AnimatePresence initial={false}>
            {section.tasks.map((task) => (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.15 }}
              >
                <TaskItem
                  task={task}
                  children={tasks.filter((t) => t.parent_id === task.id)}
                  lists={listBadges}
                  showList={scope.kind === "smart" && (scope.id === "all" || scope.id === "today")}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </section>
      ))}
    </div>
  )
}
