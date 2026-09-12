import { useMemo, useState } from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { sortableKeyboardCoordinates, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { TaskCheckbox } from "@/components/task-item"
import { PriorityBadge } from "@/components/priority-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SearchX } from "lucide-react"
import { matchTaskSearch } from "@/lib/search"
import { useUi } from "@/stores/ui"
import type { Task, TaskStatus } from "@/api/types"
import { formatDue, parseUTC } from "@/lib/dates"
import { useUpdateTask } from "@/hooks/api"
import { cn } from "cn"

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "completed", label: "Done" },
]

const DONE_CAP = 30

function byOrder(a: Task, b: Task): number {
  if (a.order_index !== b.order_index) return a.order_index - b.order_index
  return a.created_at.localeCompare(b.created_at)
}

function TaskCard({ task, dragging = false }: { task: Task; dragging?: boolean }) {
  const done = task.status === "completed"
  const due = parseUTC(task.due_date)
  const overdue = !done && due !== null && due.getTime() < Date.now()
  return (
    <div
      className={cn(
        "glass rounded-xl px-3 py-2.5 text-sm shadow-md shadow-black/10",
        dragging && "rotate-2 ring-1 ring-primary/50",
        done && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5" onClick={(e) => e.stopPropagation()}>
          <TaskCheckbox task={task} />
        </span>
        <div className="min-w-0">
          <p className={cn("leading-snug", done && "line-through opacity-70")}>{task.title}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <PriorityBadge priority={task.priority} showIcon={false} />
            {due && (
              <Badge variant="outline" className={cn("gap-1", overdue ? "text-overdue" : "text-muted-foreground")}>
                {formatDue(due)}
              </Badge>
            )}
            {task.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-muted-foreground">
                @{t}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function SortableCard({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", status: task.status },
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("touch-none", isDragging && "opacity-30")}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} />
    </div>
  )
}

function Column({ status, label, tasks, overflow }: { status: TaskStatus; label: string; tasks: Task[]; overflow: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${status}`, data: { type: "column", status } })
  return (
    <div className="flex min-h-0 w-72 shrink-0 flex-col">
      <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
        <span className="font-normal opacity-60">{tasks.length + overflow}</span>
      </h2>
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-1 flex-col gap-2 overflow-y-auto rounded-2xl border border-transparent bg-[var(--glass-hover)] p-2 transition-colors",
          isOver && "border-primary/40 bg-primary/[0.06]",
        )}
      >
        {tasks.length === 0 ? (
          <div
            className={cn(
              "flex flex-1 items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground/70 transition-colors",
              isOver ? "border-primary/50 text-foreground" : "border-[var(--glass-border)]",
            )}
          >
            {isOver ? "Release to drop" : "Drop tasks here"}
          </div>
        ) : (
          <>
            <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {tasks.map((t) => (
                <SortableCard key={t.id} task={t} />
              ))}
            </SortableContext>
            {overflow > 0 && (
              <p className="px-1 pt-1 text-[11px] text-muted-foreground">
                +{overflow} older {status === "completed" ? "completed" : ""} not shown
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function KanbanBoard({ tasks, search = "" }: { tasks: Task[]; search?: string }) {
  const updateTask = useUpdateTask()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  const visible = useMemo(() => tasks.filter((t) => matchTaskSearch(t, search)), [tasks, search])

  const columns = useMemo(() => {
    const topLevel = visible.filter((t) => t.parent_id === null)
    return COLUMNS.map((c) => {
      const all = topLevel.filter((t) => t.status === c.status).sort(byOrder)
      return {
        ...c,
        tasks: c.status === "completed" ? all.slice(0, DONE_CAP) : all,
        overflow: c.status === "completed" ? Math.max(0, all.length - DONE_CAP) : 0,
      }
    })
  }, [visible])

  function onDragStart(event: DragStartEvent) {
    setActiveTask(tasks.find((t) => t.id === event.active.id) ?? null)
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveTask(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const activeTask = tasks.find((t) => t.id === active.id)
    if (!activeTask) return

    const overData = over.data.current as { type?: string; status?: TaskStatus } | undefined
    const targetStatus = overData?.type === "column" ? overData.status : tasks.find((t) => t.id === over.id)?.status
    if (!targetStatus) return

    // mirror what the user sees: order among the filtered, top-level cards in the target column
    const columnTasks = visible
      .filter((t) => t.status === targetStatus && t.parent_id === null && t.id !== activeTask.id)
      .sort(byOrder)

    let index = columnTasks.findIndex((t) => t.id === over.id)
    if (index === -1) index = columnTasks.length

    const prev = columnTasks[index - 1]
    const next = columnTasks[index]
    const order = prev && next ? (prev.order_index + next.order_index) / 2 : prev ? prev.order_index + 1000 : next ? next.order_index - 1000 : 1000

    const patch: Partial<Task> = { order_index: order }
    if (activeTask.status !== targetStatus) patch.status = targetStatus
    updateTask.mutate({ id: activeTask.id, patch })
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveTask(null)}>
      {search && visible.filter((t) => t.parent_id === null).length === 0 ? (
        <div className="flex flex-col items-center gap-2 pt-16 text-center text-muted-foreground">
          <SearchX className="size-7 text-muted-foreground/50" />
          <p className="text-sm">
            No board tasks match <span className="font-medium text-foreground">“{search}”</span>
          </p>
          <Button variant="outline" size="sm" onClick={() => useUi.getState().setSearch("")}>
            Clear filter
          </Button>
        </div>
      ) : (
        <div className="flex h-full gap-4 overflow-x-auto px-6 pb-6">
          {columns.map((c) => (
            <Column key={c.status} status={c.status} label={c.label} tasks={c.tasks} overflow={c.overflow} />
          ))}
        </div>
      )}
      <DragOverlay>{activeTask ? <TaskCard task={activeTask} dragging /> : null}</DragOverlay>
    </DndContext>
  )
}
