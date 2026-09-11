export type TaskStatus = "todo" | "in_progress" | "completed" | "canceled"
export type Priority = 0 | 1 | 2 | 3 // 0 none, 1 low (!3), 2 med (!2), 3 high (!1)

export interface Task {
  id: string
  list_id: string | null
  parent_id: string | null
  title: string
  description: string | null
  priority: Priority
  status: TaskStatus
  due_date: string | null // naive UTC ISO from the backend
  estimated_minutes: number | null
  actual_minutes: number
  recurrence_rule: string | null
  tags: string[]
  order_index: number
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface TaskList {
  id: string
  name: string
  color: string
  icon: string | null
  is_favorite: boolean
  created_at: string
}

export interface TaskInput {
  title: string
  list_id?: string | null
  parent_id?: string | null
  description?: string | null
  priority?: Priority
  status?: TaskStatus
  due_date?: string | null
  estimated_minutes?: number | null
  recurrence_rule?: string | null
  tags?: string[]
}

export interface FocusSummary {
  date: string
  total_minutes: number
  sessions: number
}

export const LIST_COLORS = [
  "#8b5cf6",
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#64748b",
]
