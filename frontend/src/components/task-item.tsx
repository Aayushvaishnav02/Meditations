import { useState } from "react"
import { motion } from "framer-motion"
import { CalendarDays, ChevronDown, ChevronRight, Flag, MoreHorizontal, Plus, Repeat2, Sparkles, Timer } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCreateTask, useDecomposeTask, useDeleteTask, useUpdateTask } from "@/hooks/api"
import { useFocusTimer } from "@/stores/timer"
import { formatDue, formatDuration, parseUTC, toISO, startOfDay } from "@/lib/dates"
import type { Priority, Task } from "@/api/types"
import { cn } from "cn"

const PRIORITY_META: Record<Priority, { label: string; className: string } | null> = {
  3: { label: "High", className: "text-red-400 fill-red-400/20" },
  2: { label: "Medium", className: "text-amber-400 fill-amber-400/20" },
  1: { label: "Low", className: "text-sky-400 fill-sky-400/20" },
  0: null,
}

export function TaskCheckbox({ task }: { task: Task }) {
  const updateTask = useUpdateTask()
  const done = task.status === "completed"
  return (
    <Checkbox
      checked={done}
      onCheckedChange={(checked) =>
        updateTask.mutate({ id: task.id, patch: { status: checked ? "completed" : "todo" } })
      }
      aria-label={done ? `Mark "${task.title}" as open` : `Complete "${task.title}"`}
    />
  )
}

function DueChip({ task }: { task: Task }) {
  const due = parseUTC(task.due_date)
  if (!due) return null
  const overdue = task.status !== "completed" && due.getTime() < Date.now()
  return (
    <Badge variant="outline" className={cn("gap-1", overdue ? "text-red-400" : "text-muted-foreground")}>
      <CalendarDays className="size-3" />
      {formatDue(due)}
    </Badge>
  )
}

function TitleWithStrike({ task }: { task: Task }) {
  const done = task.status === "completed"
  return (
    <span className={cn("relative leading-tight", done && "text-muted-foreground")}>
      {task.title}
      {done && (
        <motion.span
          initial={{ width: 0 }}
          animate={{ width: "100%" }}
          className="absolute top-1/2 left-0 h-px bg-current opacity-60"
        />
      )}
    </span>
  )
}

function TaskMenu({ task, lists }: { task: Task; lists: { id: string; name: string }[] }) {
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const decompose = useDecomposeTask()

  const setDue = (days: number | null) => {
    if (days === null) {
      updateTask.mutate({ id: task.id, patch: { due_date: null } })
      return
    }
    const d = startOfDay(new Date())
    d.setDate(d.getDate() + days)
    d.setHours(9, 0, 0, 0)
    updateTask.mutate({ id: task.id, patch: { due_date: toISO(d) } })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Task options"
            className="opacity-0 group-hover:opacity-100 data-open:opacity-100"
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {task.status !== "completed" && (
          <DropdownMenuItem
            onClick={() => {
              useFocusTimer.setState({ taskId: task.id, open: true })
              useFocusTimer.getState().start()
            }}
          >
            <Timer className="size-4" /> Focus on this
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={decompose.isPending}
          onClick={() => decompose.mutate(task.id)}
        >
          <Sparkles className="size-4" />
          {decompose.isPending ? "Breaking down…" : "Break down with AI"}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Priority</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {([3, 2, 1, 0] as Priority[]).map((p) => (
              <DropdownMenuItem key={p} onClick={() => updateTask.mutate({ id: task.id, patch: { priority: p } })}>
                {PRIORITY_META[p]?.label ?? "None"}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Due date</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => setDue(0)}>Today</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDue(1)}>Tomorrow</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDue(7)}>Next week</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setDue(null)}>Clear</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {lists.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to list</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {lists.map((l) => (
                <DropdownMenuItem
                  key={l.id}
                  onClick={() => updateTask.mutate({ id: task.id, patch: { list_id: l.id } })}
                >
                  {l.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => deleteTask.mutate(task.id)}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AddSubtask({ parent }: { parent: Task }) {
  const [title, setTitle] = useState("")
  const [open, setOpen] = useState(false)
  const createTask = useCreateTask()

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-3" /> Subtask
      </button>
    )
  }

  return (
    <Input
      autoFocus
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && title.trim()) {
          createTask.mutate({ title: title.trim(), parent_id: parent.id, list_id: parent.list_id })
          setTitle("")
        }
        if (e.key === "Escape") setOpen(false)
      }}
      placeholder="Subtask title…"
      className="h-8 text-sm"
    />
  )
}

export function TaskItem({
  task,
  children,
  lists,
  showList = false,
}: {
  task: Task
  children: Task[]
  lists: { id: string; name: string }[]
  showList?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(task.title)
  const updateTask = useUpdateTask()

  const done = task.status === "completed"
  const prio = PRIORITY_META[task.priority]
  const listName = lists.find((l) => l.id === task.list_id)?.name

  return (
    <motion.div layout="position" className="group">
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-xl border border-transparent px-3 py-2 transition-colors hover:border-white/[0.06] hover:bg-white/[0.03]",
        )}
      >
        {children.length > 0 ? (
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"}
            className="mt-1.5 text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <span className="mt-1.5">
          <TaskCheckbox task={task} />
        </span>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={() => {
                setRenaming(false)
                if (draft.trim() && draft.trim() !== task.title) {
                  updateTask.mutate({ id: task.id, patch: { title: draft.trim() } })
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
                if (e.key === "Escape") {
                  setDraft(task.title)
                  setRenaming(false)
                }
              }}
              className="h-7"
            />
          ) : (
            <button
              onDoubleClick={() => {
                setDraft(task.title)
                setRenaming(true)
              }}
              className="block w-full cursor-text text-left text-sm"
            >
              <TitleWithStrike task={task} />
            </button>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {!done && <DueChip task={task} />}
            {prio && (
              <Badge variant="outline" className={cn("gap-1", prio.className)}>
                <Flag className="size-3" />
                {prio.label}
              </Badge>
            )}
            {task.estimated_minutes !== null && (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Timer className="size-3" />
                {formatDuration(task.estimated_minutes)}
              </Badge>
            )}
            {task.recurrence_rule && (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <Repeat2 className="size-3" />
                Repeats
              </Badge>
            )}
            {task.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-muted-foreground">
                @{tag}
              </Badge>
            ))}
            {showList && listName && (
              <Badge variant="outline" className="text-primary">
                {listName}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 pt-0.5">
          <TaskMenu task={task} lists={lists} />
        </div>
      </div>

      {expanded ? (
        <div className="ml-10 border-l border-white/[0.06] pl-3 pb-1">
          {children.map((child) => (
            <TaskItem key={child.id} task={child} children={[]} lists={lists} />
          ))}
          <div className="pb-1">
            <AddSubtask parent={task} />
          </div>
        </div>
      ) : (
        children.length > 0 && (
          <div className="ml-10 pl-3 pb-1">
            <AddSubtask parent={task} />
          </div>
        )
      )}
    </motion.div>
  )
}
