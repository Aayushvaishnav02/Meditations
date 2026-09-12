import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  BookOpen,
  Brain,
  Calendar,
  CalendarDays,
  CalendarClock,
  CheckCircle2,
  Columns3,
  Command,
  Inbox,
  List,
  ListTodo,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Timer,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { useLists, useTasks } from "@/hooks/api"
import { useUi, type Section, type SmartView } from "@/stores/ui"
import { useFocusTimer } from "@/stores/timer"
import { formatDue, parseUTC } from "@/lib/dates"
import { cn } from "cn"

type Command = {
  id: string
  label: string
  group: string
  icon: ReactNode
  hint?: string
  keywords?: string
  run: () => void
}

const GROUPS = ["Navigate", "Tasks", "Views", "Lists", "Actions"] as const

function score(text: string, q: string): number {
  const t = text.toLowerCase()
  if (t.startsWith(q)) return 3
  if (t.includes(q)) return 2
  return 0
}

function focusQuickAdd() {
  window.setTimeout(() => {
    const el = document.getElementById("quick-add-input")
    el?.focus()
    el?.scrollIntoView({ block: "nearest" })
  }, 60)
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPaletteOpen)

  // ⌘K / Ctrl+K anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        useUi.getState().setPaletteOpen(!useUi.getState().paletteOpen)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[16%] w-[34rem] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0"
      >
        {/* unmounts with the dialog, so type-ahead state resets on every open */}
        <PaletteBody />
      </DialogContent>
    </Dialog>
  )
}

function PaletteBody() {
  const setOpen = useUi((s) => s.setPaletteOpen)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const tasks = useTasks()
  const lists = useLists()
  const theme = useUi((s) => s.theme)

  const commands = useMemo<Command[]>(() => {
    const ui = useUi.getState()
    const goSection = (section: Section) => {
      ui.setSection(section)
      setOpen(false)
    }
    const goSmart = (id: SmartView) => {
      ui.setScope({ kind: "smart", id })
      setOpen(false)
    }
    const goView = (view: "list" | "board" | "calendar") => {
      ui.setSection("tasks")
      ui.setView(view)
      setOpen(false)
    }

    const nav: Command[] = [
      { id: "nav-journal", label: "Journal", group: "Navigate", icon: <BookOpen className="size-4" />, run: () => goSection("journal") },
      { id: "nav-brain", label: "Second brain", group: "Navigate", icon: <Brain className="size-4" />, run: () => goSection("second_brain") },
      { id: "nav-insights", label: "Insights", group: "Navigate", icon: <TrendingUp className="size-4" />, run: () => goSection("insights") },
      { id: "nav-settings", label: "Settings", group: "Navigate", icon: <Settings className="size-4" />, run: () => goSection("settings") },
    ]

    const smart: { id: SmartView; label: string; icon: LucideIcon }[] = [
      { id: "today", label: "Today", icon: CalendarDays },
      { id: "overdue", label: "Overdue", icon: CalendarClock },
      { id: "upcoming", label: "Upcoming", icon: ListTodo },
      { id: "all", label: "All tasks", icon: Inbox },
      { id: "completed", label: "Completed", icon: CheckCircle2 },
    ]
    const taskViews: Command[] = smart.map(({ id, label, icon: Icon }) => ({
      id: `smart-${id}`,
      label,
      group: "Tasks",
      icon: <Icon className="size-4" />,
      keywords: "tasks",
      run: () => goSmart(id),
    }))

    const views: Command[] = (
      [
        { id: "list", label: "List view", icon: List },
        { id: "board", label: "Board view", icon: Columns3 },
        { id: "calendar", label: "Calendar view", icon: Calendar },
      ] as const
    ).map(({ id, label, icon: Icon }) => ({
      id: `view-${id}`,
      label,
      group: "Views",
      icon: <Icon className="size-4" />,
      run: () => goView(id),
    }))

    const listCommands: Command[] = (lists.data ?? []).map((l) => ({
      id: `list-${l.id}`,
      label: l.name,
      group: "Lists",
      icon: <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />,
      run: () => {
        ui.setScope({ kind: "list", id: l.id })
        setOpen(false)
      },
    }))

    const actions: Command[] = [
      {
        id: "action-new-task",
        label: "New task",
        group: "Actions",
        icon: <Plus className="size-4" />,
        hint: "quick add",
        run: () => {
          setOpen(false)
          ui.setSection("tasks")
          focusQuickAdd()
        },
      },
      {
        id: "action-brain-dump",
        label: "Brain dump",
        group: "Actions",
        icon: <Brain className="size-4" />,
        hint: "AI capture",
        run: () => {
          setOpen(false)
          ui.setSection("tasks")
          ui.setCaptureOpen(true)
        },
      },
      {
        id: "action-focus-timer",
        label: "Focus timer",
        group: "Actions",
        icon: <Timer className="size-4" />,
        run: () => {
          setOpen(false)
          useFocusTimer.setState({ open: true })
        },
      },
      {
        id: "action-theme",
        label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        group: "Actions",
        icon: theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />,
        keywords: "appearance dark light mode",
        run: () => {
          ui.setTheme(theme === "dark" ? "light" : "dark")
          setOpen(false)
        },
      },
      {
        id: "action-search",
        label: "Search tasks",
        group: "Actions",
        icon: <Search className="size-4" />,
        keywords: "find filter",
        run: () => {
          setOpen(false)
          ui.setSection("tasks")
          ui.setView("list")
          window.setTimeout(() => document.getElementById("task-search-input")?.focus(), 60)
        },
      },
    ]

    return [...nav, ...taskViews, ...views, ...listCommands, ...actions]
  }, [lists.data, theme, setOpen])

  const q = query.trim().toLowerCase()

  const taskMatches = useMemo(() => {
    if (!q) return []
    return (tasks.data ?? [])
      .filter((t) => t.status !== "completed" && score(t.title, q) > 0)
      .slice(0, 6)
  }, [tasks.data, q])

  const visible = useMemo(() => {
    const base = q
      ? commands.filter((c) => score(c.label, q) > 0 || (c.keywords ?? "").toLowerCase().includes(q))
      : commands
    const taskCommands: Command[] = taskMatches.map((t) => ({
      id: `task-${t.id}`,
      label: t.title,
      group: "Tasks",
      icon: <Search className="size-4" />,
      hint: t.due_date ? formatDue(parseUTC(t.due_date)!) : undefined,
      run: () => {
        const ui = useUi.getState()
        ui.setSection("tasks")
        ui.setView("list")
        ui.setScope({ kind: "smart", id: "all" })
        ui.setSearch(t.title)
        setOpen(false)
      },
    }))
    const merged = [...base, ...taskCommands]
    const rows: ({ type: "header"; label: string } | { type: "command"; command: Command; index: number })[] = []
    let i = 0
    for (const group of GROUPS) {
      const items = merged.filter((c) => c.group === group)
      if (items.length === 0) continue
      rows.push({ type: "header", label: group })
      for (const command of items) rows.push({ type: "command", command, index: i++ })
    }
    return rows
  }, [commands, taskMatches, q, setOpen])

  const flat = useMemo(() => visible.flatMap((r) => (r.type === "command" ? [r.command] : [])), [visible])
  const activeIndex = flat.length === 0 ? 0 : Math.min(active, flat.length - 1)

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive(flat.length === 0 ? 0 : (activeIndex + 1) % flat.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive(flat.length === 0 ? 0 : (activeIndex - 1 + flat.length) % flat.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      flat[activeIndex]?.run()
    }
  }

  return (
    <div onKeyDown={onKeyDown}>
      <DialogTitle className="sr-only">Command menu</DialogTitle>
      <div className="flex items-center gap-2.5 border-b border-border px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
            placeholder="Search commands and tasks…"
            role="combobox"
            aria-expanded
            aria-controls="command-palette-list"
            aria-activedescendant={flat[activeIndex] ? `cmd-${flat[activeIndex].id}` : undefined}
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">esc</kbd>
        </div>

        <div ref={listRef} role="listbox" id="command-palette-list" className="max-h-80 overflow-y-auto p-1.5">
          {flat.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No matches for “{query}”</p>
          )}
          {visible.map((row) =>
            row.type === "header" ? (
              <div key={`header-${row.label}`} role="presentation" className="px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-widest text-muted-foreground/80 uppercase">
                {row.label}
              </div>
            ) : (
              <button
                key={row.command.id}
                id={`cmd-${row.command.id}`}
                role="option"
                aria-selected={row.index === activeIndex}
                data-index={row.index}
                onMouseEnter={() => setActive(row.index)}
                onClick={row.command.run}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none",
                  row.index === activeIndex ? "bg-accent text-accent-foreground" : "text-foreground/90",
                )}
              >
                <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{row.command.icon}</span>
                <span className="min-w-0 flex-1 truncate">{row.command.label}</span>
                {row.command.hint && <span className="shrink-0 text-xs text-muted-foreground">{row.command.hint}</span>}
              </button>
            ),
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Command className="size-3" /> K to toggle
          </span>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span className="ml-auto">{flat.length} commands</span>
        </div>
    </div>
  )
}
