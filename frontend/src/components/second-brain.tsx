import { useEffect, useMemo, useState } from "react"
import { Brain, BookOpen, CalendarRange } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useSearch, useSearchStatus } from "@/hooks/api"
import { useUi } from "@/stores/ui"
import type { SearchHit } from "@/api/types"
import { cn } from "cn"

const KIND_META: Record<SearchHit["kind"], { label: string; icon: typeof BookOpen }> = {
  journal: { label: "Journal", icon: BookOpen },
  weekly: { label: "Week", icon: CalendarRange },
  monthly: { label: "Month", icon: CalendarRange },
}

/** Highlight query words client-side — robust against brackets/markdown in content. */
function Excerpt({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => {
    const words = query
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    if (words.length === 0) return [text]
    return text.split(new RegExp(`(${words.join("|")})`, "gi"))
  }, [text, query])

  return (
    <p className="text-sm leading-relaxed text-muted-foreground">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-primary/30 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  )
}

export function SecondBrain() {
  const setSection = useUi((s) => s.setSection)
  const setJournalDay = useUi((s) => s.setJournalDay)
  const [input, setInput] = useState("")
  const [query, setQuery] = useState("")

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(input.trim()), 300)
    return () => window.clearTimeout(t)
  }, [input])

  const results = useSearch(query, true)
  const status = useSearchStatus(true)

  function openHit(hit: SearchHit) {
    if (hit.kind !== "journal") return
    setJournalDay(hit.date)
    setSection("journal")
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-6 pt-5 min-h-0">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Second brain</h1>
        <span className="ml-auto text-xs text-muted-foreground">
          {status.isPending
            ? null
            : status.data?.semantic
              ? "Semantic + keyword (local embeddings)"
              : "Keyword only (embedding model unavailable)"}
        </span>
      </div>

      <div className="glass mt-3 flex items-center gap-2 rounded-2xl px-3 py-2">
        <Brain className="size-4 text-primary" />
        <Input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. when did I start feeling burned out on the refactor?"
          className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pb-8">
        {query.length < 2 ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">
            Search across your journals, weekly rollups and monthly reviews.
          </p>
        ) : results.isError ? (
          <p className="pt-16 text-center text-sm text-red-400">
            Search failed — is the backend running?
          </p>
        ) : results.isPending ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">Searching…</p>
        ) : (results.data ?? []).length === 0 ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">Nothing found for “{query}”.</p>
        ) : (
          (results.data ?? []).map((hit) => {
            const meta = KIND_META[hit.kind]
            return (
              <button
                key={hit.doc_id}
                onClick={() => openHit(hit)}
                className={cn(
                  "glass block w-full rounded-xl px-4 py-3 text-left transition-all",
                  hit.kind === "journal" ? "hover:ring-1 hover:ring-primary/40" : "cursor-default",
                )}
              >
                <div className="flex items-center gap-2">
                  <meta.icon className="size-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium">{hit.title}</span>
                  <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
                    {meta.label}
                    {hit.sources.includes("semantic") && " · ✨ semantic"}
                  </Badge>
                </div>
                <div className="mt-1.5">
                  <Excerpt text={hit.excerpt} query={query} />
                </div>
              </button>
            )
          })
        )}
      </div>
    </main>
  )
}
