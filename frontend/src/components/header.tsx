import { useEffect, useRef } from "react"
import { Calendar, Command, List, Search, Columns3, X } from "lucide-react"
import { useUi } from "@/stores/ui"
import { useLists } from "@/hooks/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "cn"

const SMART_TITLES: Record<string, string> = {
  today: "Today",
  overdue: "Overdue",
  upcoming: "Upcoming",
  all: "All tasks",
  completed: "Completed",
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)
  )
}

export function Header() {
  const { view, setView, scope, search, setSearch, setPaletteOpen } = useUi()
  const lists = useLists()
  const searchRef = useRef<HTMLInputElement>(null)

  const title =
    scope.kind === "list"
      ? (lists.data?.find((l) => l.id === scope.id)?.name ?? "List")
      : SMART_TITLES[scope.id]

  // "/" focuses the task filter; Escape clears it while focused
  useEffect(() => {
    if (view === "calendar") return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === "Escape" && document.activeElement === searchRef.current && search) {
        setSearch("")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [view, search, setSearch])

  return (
    <div className="flex items-center gap-3 px-6 pt-5 pb-3">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {view !== "calendar" && (
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            id="task-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter tasks…  /"
            className="h-8 w-52 bg-transparent pr-7 pl-8 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear filter"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}
      {view === "calendar" && <div className="ml-auto" />}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Open command menu" onClick={() => setPaletteOpen(true)} />
          }
        >
          <Command className="size-4 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>Command menu</TooltipContent>
      </Tooltip>
      <div className="glass flex items-center gap-0.5 rounded-lg p-0.5">
        {(
          [
            { id: "list", icon: List, label: "List view" },
            { id: "board", icon: Columns3, label: "Board view" },
            { id: "calendar", icon: Calendar, label: "Calendar view" },
          ] as const
        ).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            aria-label={label}
            aria-pressed={view === id}
            title={label}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
              view === id ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {id === "list" ? "List" : id === "board" ? "Board" : "Calendar"}
          </button>
        ))}
      </div>
    </div>
  )
}
