import type { Task } from "@/api/types"

/** Backend datetimes are naive UTC; JS Date parses naive strings as local. */
export function parseUTC(s: string | null | undefined): Date | null {
  if (!s) return null
  const looksAware = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
  const d = new Date(looksAware ? s : `${s}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** ISO with offset (aware) so the backend can normalize to UTC. */
export function toISO(d: Date): string {
  return d.toISOString()
}

export function startOfDay(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000)
}

export function formatDue(due: Date): string {
  const now = new Date()
  const diff = daysBetween(now, due)
  const time = due.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  if (diff === 0) return `Today ${time}`
  if (diff === 1) return `Tomorrow ${time}`
  if (diff === -1) return `Yesterday ${time}`
  const sameYear = due.getFullYear() === now.getFullYear()
  const day = due.toLocaleDateString(undefined, {
    weekday: diff > 1 && diff < 7 ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  })
  return `${day} ${time}`
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export type TaskGroup = "overdue" | "today" | "tomorrow" | "upcoming" | "nodate" | "completed"

export function groupOf(task: Task, now: Date = new Date()): TaskGroup {
  if (task.status === "completed") return "completed"
  if (!task.due_date) return "nodate"
  const due = parseUTC(task.due_date)
  if (!due) return "nodate"
  const diff = daysBetween(now, due)
  if (diff < 0) return "overdue"
  if (diff === 0) return "today"
  if (diff === 1) return "tomorrow"
  return "upcoming"
}

export const GROUP_ORDER: TaskGroup[] = ["overdue", "today", "tomorrow", "upcoming", "nodate", "completed"]

export const GROUP_LABELS: Record<TaskGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  upcoming: "Upcoming",
  nodate: "No date",
  completed: "Completed",
}

/** Sort by due date (nulls last), then manual order, then creation. */
export function sortTasks(a: Task, b: Task): number {
  const aDue = a.due_date ? parseUTC(a.due_date)!.getTime() : Number.POSITIVE_INFINITY
  const bDue = b.due_date ? parseUTC(b.due_date)!.getTime() : Number.POSITIVE_INFINITY
  if (aDue !== bDue) return aDue - bDue
  if (a.order_index !== b.order_index) return a.order_index - b.order_index
  return a.created_at.localeCompare(b.created_at)
}
