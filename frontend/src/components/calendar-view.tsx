import { useMemo, useState } from "react"
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useCreateTask, useUpdateTask } from "@/hooks/api"
import { formatDuration, parseUTC, toISO } from "@/lib/dates"
import type { Task } from "@/api/types"
import { cn } from "cn"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function localDayParam(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

const PRIORITY_DOT: Record<number, string> = {
  3: "bg-red-400",
  2: "bg-amber-400",
  1: "bg-sky-400",
  0: "bg-muted-foreground/40",
}

function TaskChip({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { type: "calendar-task" },
  })
  const due = parseUTC(task.due_date)!
  const overdue = task.status !== "completed" && due.getTime() < Date.now()
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "flex w-full touch-none items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight transition-colors hover:bg-accent/70",
        isDragging && "opacity-30",
        task.status === "completed" && "text-muted-foreground line-through opacity-60",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])} />
      <span className="truncate">{task.title}</span>
      {due.getHours() !== 9 && (
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          {due.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </span>
      )}
      {task.estimated_minutes !== null && (
        <span className="shrink-0 text-[10px] text-muted-foreground">{formatDuration(task.estimated_minutes)}</span>
      )}
      {overdue && <span className="size-1.5 shrink-0 rounded-full bg-red-400" />}
    </button>
  )
}

function DayCell({
  day,
  inMonth,
  tasks,
  onOpen,
}: {
  day: Date
  inMonth: boolean
  tasks: Task[]
  onOpen: (day: Date) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${localDayParam(day)}`, data: { type: "day", date: day } })
  const isToday = localDayParam(day) === localDayParam(new Date())

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-24 flex-col gap-0.5 rounded-lg border p-1.5 transition-colors",
        inMonth ? "border-[var(--glass-border)] bg-[var(--glass-bg)]" : "border-transparent opacity-50",
        isOver && "border-primary/60 bg-primary/10",
      )}
    >
      <div className="flex items-center justify-between px-0.5">
        <span
          className={cn(
            "text-xs",
            isToday ? "flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {day.getDate()}
        </span>
        <button
          onClick={() => onOpen(day)}
          aria-label={`Add task on ${localDayParam(day)}`}
          className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 hover:opacity-100 md:opacity-0 md:group-hover:opacity-100"
        >
          <Plus className="size-3" />
        </button>
      </div>
      {tasks.slice(0, 4).map((t) => (
        <TaskChip key={t.id} task={t} />
      ))}
      {tasks.length > 4 && (
        <button onClick={() => onOpen(day)} className="px-1 text-left text-[10px] text-muted-foreground hover:text-foreground">
          +{tasks.length - 4} more
        </button>
      )}
    </div>
  )
}

export function CalendarView({ tasks }: { tasks: Task[] }) {
  const updateTask = useUpdateTask()
  const createTask = useCreateTask()
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [openDay, setOpenDay] = useState<Date | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const weeks = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const gridStart = new Date(first)
    gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7)) // back to Monday
    const byDay = new Map<string, Task[]>()
    for (const t of tasks) {
      const due = parseUTC(t.due_date)
      if (!due) continue
      const key = localDayParam(due)
      const bucket = byDay.get(key) ?? []
      bucket.push(t)
      byDay.set(key, bucket)
    }
    for (const bucket of byDay.values()) {
      bucket.sort((a, b) => (parseUTC(a.due_date)!.getTime() ?? 0) - (parseUTC(b.due_date)!.getTime() ?? 0))
    }
    return Array.from({ length: 6 }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const day = new Date(gridStart)
        day.setDate(gridStart.getDate() + w * 7 + d)
        return { day, inMonth: day.getMonth() === cursor.getMonth(), tasks: byDay.get(localDayParam(day)) ?? [] }
      }),
    )
  }, [cursor, tasks])

  function onDragStart(_event: DragStartEvent) {
    // no overlay needed; the chip itself stays visible via opacity
  }

  function onDragEnd(event: DragEndEvent) {
    const overData = event.over?.data.current as { type?: string; date?: Date } | undefined
    const task = tasks.find((t) => t.id === event.active.id)
    if (!overData || overData.type !== "day" || !overData.date || !task) return
    const due = parseUTC(task.due_date)
    if (!due) return
    const target = overData.date
    if (localDayParam(due) === localDayParam(target)) return
    const next = new Date(target.getFullYear(), target.getMonth(), target.getDate(), due.getHours(), due.getMinutes())
    updateTask.mutate({ id: task.id, patch: { due_date: toISO(next) } })
  }

  function addOnDay() {
    if (!openDay || !newTitle.trim()) return
    createTask.mutate({ title: newTitle.trim(), due_date: toISO(new Date(openDay.getFullYear(), openDay.getMonth(), openDay.getDate(), 9, 0)) })
    setNewTitle("")
  }

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })

  return (
    <div className="px-6 pb-8">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-base font-semibold">{monthLabel}</h2>
        <Button variant="ghost" size="icon-xs" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month">
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} aria-label="Today">
          <span className="text-xs">Today</span>
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month">
          <ChevronRight />
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">Drag tasks between days to reschedule</span>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-7 gap-1 px-1 pb-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              {w}
            </div>
          ))}
        </div>
        <div className="group/grid grid grid-cols-7 gap-1">
          {weeks.flat().map(({ day, inMonth, tasks: dayTasks }, i) => (
            <DayCell key={i} day={day} inMonth={inMonth} tasks={dayTasks} onOpen={setOpenDay} />
          ))}
        </div>
      </DndContext>

      <Dialog open={openDay !== null} onOpenChange={(o) => !o && setOpenDay(null)}>
        <DialogContent className="w-[28rem]">
          <DialogHeader>
            <DialogTitle>
              {openDay?.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </DialogTitle>
          </DialogHeader>
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addOnDay()}
            placeholder="Add a task for this day…"
            className="mt-2"
          />
          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {openDay &&
              (byDayLocal(tasks).get(localDayParam(openDay)) ?? []).map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent/50">
                  <span className={cn("size-1.5 rounded-full", PRIORITY_DOT[t.priority])} />
                  <span className={cn("truncate", t.status === "completed" && "text-muted-foreground line-through")}>{t.title}</span>
                  <button
                    className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => updateTask.mutate({ id: t.id, patch: { due_date: null } })}
                  >
                    remove date
                  </button>
                </div>
              ))}
            {openDay && (byDayLocal(tasks).get(localDayParam(openDay)) ?? []).length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">Nothing scheduled.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function byDayLocal(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>()
  for (const t of tasks) {
    const due = parseUTC(t.due_date)
    if (!due) continue
    const key = localDayParam(due)
    const bucket = map.get(key) ?? []
    bucket.push(t)
    map.set(key, bucket)
  }
  return map
}
