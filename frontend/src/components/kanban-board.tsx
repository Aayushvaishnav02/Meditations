import { useMemo, useState } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import type { Priority, Task, TaskStatus } from "@/api/types"
import { formatDue, parseUTC } from "@/lib/dates"
import { useUpdateTask } from "@/hooks/api"
import { cn } from "cn"

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "completed", label: "Done" },
]

const PRIORITY_CLASS: Record<Priority, string> = {
  3: "text-red-400",
  2: "text-amber-400",
  1: "text-sky-400",
  0: "text-muted-foreground/0",
}

function byOrder(a: Task, b: Task): number {
  if (a.order_index !== b.order_index) return a.order_index - b.order_index
  return a.created_at.localeCompare(b.created_at)
}

function TaskCard({ task, dragging = false }: { task: Task; dragging?: boolean }) {
  const updateTask = useUpdateTask()
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
          <Checkbox
            checked={done}
            onCheckedChange={(checked) =>
              updateTask.mutate({ id: task.id, patch: { status: checked ? "completed" : "todo" } })
            }
          />
        </span>
        <div className="min-w-0">
          <p className={cn("leading-snug", done && "line-through opacity-70")}>{task.title}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {task.priority !== 0 && (
              <Badge variant="outline" className={cn("px-1", PRIORITY_CLASS[task.priority])}>
                P{task.priority}
              </Badge>
            )}
            {due && (
              <Badge variant="outline" className={cn("px-1", overdue ? "text-red-400" : "text-muted-foreground")}>
                {formatDue(due)}
              </Badge>
            )}
            {task.tags.map((t) => (
              <Badge key={t} variant="outline" className="px-1 text-muted-foreground">
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

function Column({ status, label, tasks }: { status: TaskStatus; label: string; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${status}`, data: { type: "column", status } })
  return (
    <div className="flex min-h-0 w-72 shrink-0 flex-col">
      <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
        <span className="font-normal opacity-60">{tasks.length}</span>
      </h2>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 space-y-2 overflow-y-auto rounded-2xl border border-white/[0.05] bg-white/[0.02] p-2 transition-colors",
          isOver && "border-primary/40 bg-primary/[0.04]",
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => (
            <SortableCard key={t.id} task={t} />
          ))}
        </SortableContext>
      </div>
    </div>
  )
}

export function KanbanBoard({ tasks }: { tasks: Task[] }) {
  const updateTask = useUpdateTask()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  const columns = useMemo(() => {
    const topLevel = tasks.filter((t) => t.parent_id === null)
    return COLUMNS.map((c) => ({
      ...c,
      tasks: topLevel
        .filter((t) => t.status === c.status)
        .sort(byOrder)
        .slice(0, c.status === "completed" ? 30 : undefined),
    }))
  }, [tasks])

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

    const columnTasks = tasks
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
      <div className="flex h-full gap-4 overflow-x-auto px-6 pb-6">
        {columns.map((c) => (
          <Column key={c.status} status={c.status} label={c.label} tasks={c.tasks} />
        ))}
      </div>
      <DragOverlay>{activeTask ? <TaskCard task={activeTask} dragging /> : null}</DragOverlay>
    </DndContext>
  )
}
