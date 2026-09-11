import { create } from "zustand"
import { persist } from "zustand/middleware"

export type MainView = "list" | "board"
export type SmartView = "today" | "overdue" | "upcoming" | "all" | "completed"

export type Scope = { kind: "smart"; id: SmartView } | { kind: "list"; id: string }

interface UiState {
  view: MainView
  scope: Scope
  search: string
  setView: (view: MainView) => void
  setScope: (scope: Scope) => void
  setSearch: (search: string) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      view: "list",
      scope: { kind: "smart", id: "today" },
      search: "",
      setView: (view) => set({ view }),
      setScope: (scope) => set({ scope }),
      setSearch: (search) => set({ search }),
    }),
    {
      name: "journal-ui",
      partialize: (s) => ({ view: s.view, scope: s.scope }),
    },
  ),
)
