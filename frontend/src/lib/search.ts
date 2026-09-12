import type { Task } from "@/api/types"

/** Case-insensitive match on title and tags; shared by list and board views. */
export function matchTaskSearch(task: Task, search: string): boolean {
  if (!search) return true
  const q = search.toLowerCase()
  return task.title.toLowerCase().includes(q) || task.tags.some((t) => t.toLowerCase().includes(q))
}
