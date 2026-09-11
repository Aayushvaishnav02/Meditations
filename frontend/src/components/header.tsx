import { List, Search, Columns3 } from "lucide-react"
import { useUi } from "@/stores/ui"
import { useLists } from "@/hooks/api"
import { Input } from "@/components/ui/input"
import { cn } from "cn"

const SMART_TITLES: Record<string, string> = {
  today: "Today",
  overdue: "Overdue",
  upcoming: "Upcoming",
  all: "All tasks",
  completed: "Completed",
}

export function Header() {
  const { view, setView, scope, search, setSearch } = useUi()
  const lists = useLists()

  const title =
    scope.kind === "list"
      ? (lists.data?.find((l) => l.id === scope.id)?.name ?? "List")
      : SMART_TITLES[scope.id]

  return (
    <div className="flex items-center gap-3 px-6 pt-5 pb-3">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <div className="relative ml-auto">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="h-8 w-52 bg-transparent pl-8 text-sm"
        />
      </div>
      <div className="glass flex items-center gap-0.5 rounded-lg p-0.5">
        {(
          [
            { id: "list", icon: List, label: "List view" },
            { id: "board", icon: Columns3, label: "Board view" },
          ] as const
        ).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            aria-label={label}
            title={label}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
              view === id ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {id === "list" ? "List" : "Board"}
          </button>
        ))}
      </div>
    </div>
  )
}
