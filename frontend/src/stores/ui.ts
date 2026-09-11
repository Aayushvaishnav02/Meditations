import { create } from "zustand"
import { persist } from "zustand/middleware"

export type MainView = "list" | "board"
export type SmartView = "today" | "overdue" | "upcoming" | "all" | "completed"
export type Section = "tasks" | "journal"

export type Scope = { kind: "smart"; id: SmartView } | { kind: "list"; id: string }

interface UiState {
  section: Section
  view: MainView
  scope: Scope
  search: string
  setSection: (section: Section) => void
  setView: (view: MainView) => void
  setScope: (scope: Scope) => void
  setSearch: (search: string) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      section: "tasks",
      view: "list",
      scope: { kind: "smart", id: "today" },
      search: "",
      setSection: (section) => set({ section }),
      setView: (view) => set({ view }),
      setScope: (scope) => set({ scope, section: "tasks" }),
      setSearch: (search) => set({ search }),
    }),
    {
      name: "journal-ui",
      partialize: (s) => ({ section: s.section, view: s.view, scope: s.scope }),
    },
  ),
)
