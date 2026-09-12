import { useEffect, useMemo, useRef, useState } from "react"
import { Brain, BookOpen, CalendarRange, MessageCircleQuestion, RotateCcw, Search, Send } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useSearch, useSearchStatus, useSecondBrainChat, type ChatMessage } from "@/hooks/api"
import { useUi } from "@/stores/ui"
import type { CitationSource, SearchHit } from "@/api/types"
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
          <span key={part + i}>{part}</span>
        ),
      )}
    </p>
  )
}

function SourceRow({ source }: { source: CitationSource }) {
  const setSection = useUi((s) => s.setSection)
  const setJournalDay = useUi((s) => s.setJournalDay)
  const meta = KIND_META[source.kind]
  const clickable = source.kind === "journal"

  return (
    <button
      type="button"
      onClick={() => {
        if (!clickable) return
        setJournalDay(source.date)
        setSection("journal")
      }}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground",
        clickable ? "hover:bg-primary/10 hover:text-foreground" : "cursor-default",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[9px] font-semibold text-primary">
        {source.n}
      </span>
      <meta.icon className="size-3 shrink-0" />
      <span className="truncate">{source.title}</span>
    </button>
  )
}

/** Renders [n] citation markers as clickable chips that mirror the source list. */
function AnswerText({ text, sources }: { text: string; sources?: CitationSource[] }) {
  const parts = useMemo(() => text.split(/(\[\d+\])/g), [text])
  const jumpTo = useUi((s) => s.setJournalDay)
  const setSection = useUi((s) => s.setSection)

  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/)
        if (!match) return <span key={i}>{part}</span>
        const n = Number(match[1])
        const source = sources?.find((s) => s.n === n)
        if (!source) return <span key={i}>{part}</span>
        return (
          <button
            key={i}
            type="button"
            onClick={() => {
              if (source.kind !== "journal") return
              jumpTo(source.date)
              setSection("journal")
            }}
            title={`${source.title} (${KIND_META[source.kind].label})`}
            className="mx-0.5 inline-flex size-4.5 items-center justify-center rounded-full bg-primary/20 align-middle text-[9px] font-semibold text-primary hover:bg-primary/30"
          >
            {n}
          </button>
        )
      })}
    </p>
  )
}

function ChatBubble({ message, isLast, pending }: { message: ChatMessage; isLast: boolean; pending: boolean }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/20 px-3.5 py-2 text-sm">{message.content}</div>
      </div>
    )
  }
  const streaming = isLast && pending
  return (
    <div className="max-w-[95%] space-y-1.5">
      {message.content ? (
        <AnswerText text={message.content} sources={message.sources} />
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Brain className="size-3.5 animate-pulse" /> Searching your journals…
        </p>
      )}
      {message.sources && message.sources.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {message.sources.map((s) => (
            <SourceRow key={s.doc_id} source={s} />
          ))}
        </div>
      )}
      {streaming && message.content && (
        <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
      )}
    </div>
  )
}

export function SecondBrain() {
  const setSection = useUi((s) => s.setSection)
  const setJournalDay = useUi((s) => s.setJournalDay)
  const [mode, setMode] = useState<"ask" | "search">("ask")
  const [input, setInput] = useState("")
  const [query, setQuery] = useState("")
  const chat = useSecondBrainChat()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(input.trim()), 300)
    return () => window.clearTimeout(t)
  }, [input])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [chat.messages])

  const results = useSearch(query, mode === "search")
  const status = useSearchStatus(true)

  function openHit(hit: SearchHit) {
    if (hit.kind !== "journal") return
    setJournalDay(hit.date)
    setSection("journal")
  }

  function submit() {
    const q = input.trim()
    if (!q || chat.pending) return
    if (mode === "ask") {
      chat.send(q)
      setInput("")
    } else {
      setQuery(q)
    }
  }

  return (
    <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pt-5">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Second brain</h1>
          <div className="flex items-center rounded-full border border-border/60 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("ask")}
              className={cn("flex items-center gap-1 rounded-full px-2.5 py-1", mode === "ask" ? "bg-primary/20 text-primary" : "text-muted-foreground")}
            >
              <MessageCircleQuestion className="size-3.5" /> Ask
            </button>
            <button
              type="button"
              onClick={() => setMode("search")}
              className={cn("flex items-center gap-1 rounded-full px-2.5 py-1", mode === "search" ? "bg-primary/20 text-primary" : "text-muted-foreground")}
            >
              <Search className="size-3.5" /> Search
            </button>
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            {status.isPending
              ? null
              : status.data?.semantic
                ? "Semantic + keyword (local embeddings)"
                : "Keyword only (embedding model unavailable)"}
          </span>
        </div>

        <div className="glass sticky top-0 z-10 mt-3 flex items-center gap-2 rounded-2xl px-3 py-2">
          <Brain className="size-4 shrink-0 text-primary" />
          <Input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={mode === "ask" ? "Ask your journals a question…" : "Keyword search across everything…"}
            className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          {mode === "ask" && chat.messages.length > 0 && (
            <Button variant="ghost" size="icon-xs" aria-label="New conversation" onClick={chat.reset}>
              <RotateCcw />
            </Button>
          )}
          {mode === "ask" && input.trim() && (
            <Button variant="ghost" size="icon-xs" aria-label="Send" disabled={chat.pending} onClick={submit}>
              <Send />
            </Button>
          )}
        </div>

        {mode === "ask" ? (
          <div className="flex-1 space-y-4 py-4">
            {chat.messages.length === 0 ? (
              <p className="pt-12 text-center text-sm text-muted-foreground">
                Ask anything about your past — the AI answers from your journals, weekly rollups and monthly
                reviews, with citations.
              </p>
            ) : (
              <>
                {chat.messages.map((m, i) => (
                  <ChatBubble key={i} message={m} isLast={i === chat.messages.length - 1} pending={chat.pending} />
                ))}
                <div ref={bottomRef} />
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-2 pb-8">
            {query.length < 2 ? (
              <p className="pt-16 text-center text-sm text-muted-foreground">
                Search across your journals, weekly rollups and monthly reviews.
              </p>
            ) : results.isError ? (
              <p className="pt-16 text-center text-sm text-destructive">Search failed — is the backend running?</p>
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
                    <div className="flex min-w-0 items-center gap-2">
                      <meta.icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm font-medium">{hit.title}</span>
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
        )}
      </div>
    </main>
  )
}
