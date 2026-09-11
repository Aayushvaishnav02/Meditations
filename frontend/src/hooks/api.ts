import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, ApiError } from "@/api/client"
import type { JournalActivity, JournalEntry, JournalInput, Task, TaskInput, TaskList } from "@/api/types"

export const qk = {
  tasks: ["tasks"] as const,
  lists: ["lists"] as const,
  health: ["health"] as const,
}

export function useTasks() {
  return useQuery({ queryKey: qk.tasks, queryFn: () => api.get<Task[]>("/tasks") })
}

export function useLists() {
  return useQuery({ queryKey: qk.lists, queryFn: () => api.get<TaskList[]>("/lists") })
}

export function useHealth() {
  return useQuery({
    queryKey: qk.health,
    queryFn: () => api.get<{ status: string }>("/health"),
    refetchInterval: 30_000,
    retry: 0,
  })
}

function patchTaskInCache(qc: ReturnType<typeof useQueryClient>, id: string, patch: Partial<Task>) {
  qc.setQueryData<Task[]>(qk.tasks, (old) =>
    (old ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)),
  )
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TaskInput) => api.post<Task>("/tasks", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: qk.tasks })
      const prev = qc.getQueryData<Task[]>(qk.tasks)
      const now = new Date().toISOString()
      const temp: Task = {
        id: `temp-${crypto.randomUUID()}`,
        list_id: input.list_id ?? null,
        parent_id: input.parent_id ?? null,
        title: input.title,
        description: null,
        priority: input.priority ?? 0,
        status: input.status ?? "todo",
        due_date: input.due_date ?? null,
        estimated_minutes: input.estimated_minutes ?? null,
        actual_minutes: 0,
        recurrence_rule: input.recurrence_rule ?? null,
        tags: input.tags ?? [],
        order_index: Date.now(),
        completed_at: null,
        created_at: now,
        updated_at: now,
      }
      qc.setQueryData<Task[]>(qk.tasks, (old) => [...(old ?? []), temp])
      return { prev }
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.tasks, ctx.prev)
      toast.error("Couldn't create task")
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tasks }),
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Task> }) =>
      api.patch<Task>(`/tasks/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.tasks })
      const prev = qc.getQueryData<Task[]>(qk.tasks)
      const extras: Partial<Task> = {}
      if (patch.status === "completed") extras.completed_at = new Date().toISOString()
      if (patch.status !== undefined && patch.status !== "completed") extras.completed_at = null
      patchTaskInCache(qc, id, { ...patch, ...extras })
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.tasks, ctx.prev)
      toast.error("Couldn't update task")
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tasks }),
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/tasks/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.tasks })
      const prev = qc.getQueryData<Task[]>(qk.tasks)
      qc.setQueryData<Task[]>(qk.tasks, (old) => (old ?? []).filter((t) => t.id !== id && t.parent_id !== id))
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.tasks, ctx.prev)
      toast.error("Couldn't delete task")
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.tasks }),
  })
}

export function useCreateSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { task_id?: string | null; duration_minutes: number; session_type?: string }) =>
      api.post<Task>("/focus/sessions", input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.tasks })
      qc.invalidateQueries({ queryKey: ["focus-summary"] })
    },
  })
}

export function useJournalEntry(day: string) {
  return useQuery({
    queryKey: ["journal", day],
    queryFn: async () => {
      try {
        return await api.get<JournalEntry>(`/journal/${day}`)
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null // empty entry, not an error
        throw e
      }
    },
  })
}

export function useSaveJournal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: JournalInput & { day: string }) =>
      api.put<JournalEntry>(`/journal/${input.day}`, { raw_markdown: input.raw_markdown, mood: input.mood ?? null, energy: input.energy ?? null }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["journal", input.day] })
      const prev = qc.getQueryData<JournalEntry>(["journal", input.day])
      if (prev) {
        qc.setQueryData<JournalEntry>(["journal", input.day], {
          ...prev,
          raw_markdown: input.raw_markdown,
          mood: input.mood ?? null,
          energy: input.energy ?? null,
          updated_at: new Date().toISOString(),
        })
      }
      return { prev }
    },
    onError: (_err, input, ctx) => {
      if (ctx?.prev) qc.setQueryData(["journal", input.day], ctx.prev)
      toast.error("Couldn't save journal entry")
    },
    onSettled: (_d, _e, input) => qc.invalidateQueries({ queryKey: ["journal", input.day] }),
  })
}

export function useJournalActivity(day: string) {
  return useQuery({
    queryKey: ["journal-activity", day],
    queryFn: () => api.get<JournalActivity>(`/journal/${day}/activity`),
  })
}

export function useCreateList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string }) => api.post<TaskList>("/lists", input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: qk.lists })
      const prev = qc.getQueryData<TaskList[]>(qk.lists)
      const temp: TaskList = {
        id: `temp-${crypto.randomUUID()}`,
        name: input.name,
        color: "#64748b",
        icon: null,
        is_favorite: false,
        created_at: new Date().toISOString(),
      }
      qc.setQueryData<TaskList[]>(qk.lists, (old) => [...(old ?? []), temp])
      return { prev }
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.lists, ctx.prev)
      toast.error("Couldn't create list")
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.lists }),
  })
}

export function useUpdateList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<TaskList> }) =>
      api.patch<TaskList>(`/lists/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.lists })
      const prev = qc.getQueryData<TaskList[]>(qk.lists)
      qc.setQueryData<TaskList[]>(qk.lists, (old) =>
        (old ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l)),
      )
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.lists, ctx.prev)
      toast.error("Couldn't update list")
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.lists }),
  })
}

export function useDeleteList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/lists/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.lists })
      const prevLists = qc.getQueryData<TaskList[]>(qk.lists)
      const prevTasks = qc.getQueryData<Task[]>(qk.tasks)
      qc.setQueryData<TaskList[]>(qk.lists, (old) => (old ?? []).filter((l) => l.id !== id))
      qc.setQueryData<Task[]>(qk.tasks, (old) =>
        (old ?? []).map((t) => (t.list_id === id ? { ...t, list_id: null } : t)),
      )
      return { prevLists, prevTasks }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevLists) qc.setQueryData(qk.lists, ctx.prevLists)
      if (ctx?.prevTasks) qc.setQueryData(qk.tasks, ctx.prevTasks)
      toast.error("Couldn't delete list")
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.lists })
      qc.invalidateQueries({ queryKey: qk.tasks })
    },
  })
}
