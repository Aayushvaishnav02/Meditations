import { create } from "zustand"
import { persist } from "zustand/middleware"

export type MainView = "list" | "board" | "calendar"
export type Theme = "dark" | "light" | "tokyo-night" | "rose-pine" | "gruvbox" | "dracula" | "nord" | "ayu"
export type SmartView = "today" | "overdue" | "upcoming" | "all" | "completed"
export type Section = "tasks" | "journal" | "second_brain" | "insights" | "settings"

export const THEMES: { id: Theme; label: string; dark: boolean }[] = [
  { id: "dark", label: "Dark", dark: true },
  { id: "light", label: "Light", dark: false },
  { id: "tokyo-night", label: "Tokyo Night", dark: true },
  { id: "rose-pine", label: "Rosé Pine", dark: true },
  { id: "gruvbox", label: "Gruvbox", dark: true },
  { id: "dracula", label: "Dracula", dark: true },
  { id: "nord", label: "Nord", dark: true },
  { id: "ayu", label: "Ayu", dark: true },
]

export type Scope = { kind: "smart"; id: SmartView } | { kind: "list"; id: string }

interface UiState {
  section: Section
  view: MainView
  scope: Scope
  search: string
  /** consumed once by the journal view when arriving from Second Brain */
  journalDay: string | null
  theme: Theme
  /** global ⌘K command palette */
  paletteOpen: boolean
  /** brain-dump capture dialog inside QuickAdd */
  captureOpen: boolean
  setSection: (section: Section) => void
  setTheme: (theme: Theme) => void
  setView: (view: MainView) => void
  setScope: (scope: Scope) => void
  setSearch: (search: string) => void
  setJournalDay: (day: string | null) => void
  setPaletteOpen: (open: boolean) => void
  setCaptureOpen: (open: boolean) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      section: "tasks",
      view: "list",
      scope: { kind: "smart", id: "today" },
      search: "",
      journalDay: null,
      theme: "dark",
      paletteOpen: false,
      captureOpen: false,
      setSection: (section) => set({ section }),
      setTheme: (theme) => set({ theme }),
      setJournalDay: (journalDay) => set({ journalDay }),
      setView: (view) => set({ view }),
      setScope: (scope) => set({ scope, section: "tasks" }),
      setSearch: (search) => set({ search }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setCaptureOpen: (captureOpen) => set({ captureOpen }),
    }),
    {
      name: "journal-ui",
      partialize: (s) => ({ section: s.section, view: s.view, scope: s.scope, theme: s.theme }),
    },
  ),
)
