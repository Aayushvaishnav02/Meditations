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

export interface JournalEntry {
  date: string // YYYY-MM-DD
  raw_markdown: string
  mood: number | null
  energy: number | null
  hours_deep_work: number
  tasks_planned: number
  tasks_done: number
  created_at: string
  updated_at: string
}

export interface JournalDay {
  date: string
  mood: number | null
  energy: number | null
}

export interface JournalInput {
  raw_markdown: string
  mood?: number | null
  energy?: number | null
}

export interface ActivityTask {
  id: string
  title: string
}

export interface ActivityHabit {
  id: string
  name: string
  completed: boolean
}

export interface JournalActivity {
  date: string
  tasks_done: ActivityTask[]
  tasks_planned: number
  focus_minutes: number
  focus_sessions: number
  habits: ActivityHabit[]
}

export interface SearchHit {
  doc_id: string
  kind: "journal" | "weekly" | "monthly"
  title: string
  date: string
  excerpt: string
  score: number
  sources: string[]
}

export interface AISettingsView {
  provider: string
  model_name: string
  fast_model_name: string | null
  base_url: string | null
  api_key_set: boolean
}

export interface AIConnectionTest {
  ok: boolean
  model: string
  reply: string | null
  latency_ms: number | null
  error: string | null
}

export interface AppPrefs {
  target_deep_work_hours: number
}

export interface DailyScoreResponse {
  date: string
  task_score: number
  focus_score: number
  habit_score: number
  weighted_score: number
  llm_nudge: number
  final_score: number
  target_deep_work_hours: number
  metrics: {
    tasks_completed: number
    tasks_planned: number
    deep_work_hours: number
    habits_completed: number
    habits_scheduled: number
  }
  persisted: boolean
  feedback: string | null
  insight: string | null
}

export interface Briefing {
  top_focus: string[]
  reasoning: string
  overdue_count: number
  due_today_count: number
}

export interface CaptureResult {
  tasks: Task[]
  journal_snippet: string
}

export interface InsightDay {
  date: string
  score: number
  tasks_completed: number
  tasks_planned: number
  deep_work_hours: number
  habits_completed: number
  habits_scheduled: number
  mood: number | null
  energy: number | null
}

export interface HabitInsight {
  id: string
  name: string
  current_streak: number
  rate_30: number
}

export interface InsightsResponse {
  days: number
  series: InsightDay[]
  journaling_streak: number
  journaling_best: number
  habits: HabitInsight[]
  weekly: { week_start: string; avg_score: number; trend: string }[]
  monthly: { month: string; avg_score: number; trend: string }[]
  totals: {
    avg_score_7: number
    avg_score_prev_7: number | null
    total_focus_hours: number
    tasks_done: number
    completion_rate: number
    target_deep_work_hours: number
  }
}

export interface SearchStatus {
  fts: boolean
  semantic: boolean
  indexed_docs: number
}

export interface CitationSource {
  n: number
  doc_id: string
  title: string
  date: string
  kind: "journal" | "weekly" | "monthly"
}

export interface PromptEntry {
  key: string
  default: string
  override: string | null
}

export interface AiUsageByAgent {
  agent: string
  calls: number
  input_tokens: number
  output_tokens: number
}

export interface AiUsageView {
  days: number
  calls: number
  input_tokens: number
  output_tokens: number
  by_agent: AiUsageByAgent[]
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
