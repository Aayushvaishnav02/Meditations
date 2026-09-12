import { useEffect, useMemo, useRef, useState } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { Markdown } from "tiptap-markdown"
import { Check, ChevronLeft, ChevronRight, ListChecks, Sparkles, Wand2, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { MiniMonth } from "@/components/journal-calendar"
import { JournalCalendar } from "@/components/journal-calendar-view"
import { DailyReviewCard } from "@/components/daily-review-card"
import { Button } from "@/components/ui/button"
import { useEditorAssist, useJournalActivity, useJournalDays, useJournalEntry, useSaveJournal } from "@/hooks/api"
import { SlashCommands, type AssistAction } from "@/components/slash-command"
import { formatDuration } from "@/lib/dates"
import { useUi } from "@/stores/ui"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { cn } from "cn"
import type { Editor } from "@tiptap/core"

function getMarkdown(ed: Editor): string {
  return (ed.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
}

function toDayParam(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

const REFLECTION_TEMPLATE = `## Reflection

- **Friction:** 
- **Win:** 
- **Deprioritize tomorrow:** `

function buildActivityMarkdown(a: {
  tasks_done: { title: string }[]
  focus_minutes: number
  focus_sessions: number
  habits: { name: string; completed: boolean }[]
}): string {
  const lines: string[] = ["## Day activity", ""]
  lines.push(`**Tasks done:** ${a.tasks_done.length}`)
  for (const t of a.tasks_done) lines.push(`- [x] ${t.title}`)
  lines.push("")
  lines.push(
    `**Focus:** ${formatDuration(a.focus_minutes)} across ${a.focus_sessions} session${a.focus_sessions === 1 ? "" : "s"}`,
  )
  if (a.habits.length > 0) {
    lines.push("")
    lines.push(`**Habits:** ${a.habits.map((h) => `${h.completed ? "✅" : "⬜"} ${h.name}`).join(" · ")}`)
  }
  lines.push("")
  return lines.join("\n")
}

function RatingRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-14 text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange(value === n ? null : n)}
            aria-label={`${label} ${n} of 5`}
            className={cn(
              "size-5 rounded-full border transition-all",
              value !== null && n <= value
                ? "border-primary bg-primary/70"
                : "border-[var(--glass-border)] hover:border-primary/40",
              value === n && "ring-2 ring-primary/50",
            )}
          />
        ))}
      </div>
    </div>
  )
}

export function JournalView() {
  const section = useUi((s) => s.section)
  const journalDay = useUi((s) => s.journalDay)
  const [day, setDay] = useState(() => journalDay ?? toDayParam(new Date()))
  const [mood, setMood] = useState<number | null>(null)
  const [energy, setEnergy] = useState<number | null>(null)

  const entry = useJournalEntry(day)
  const save = useSaveJournal()
  const activity = useJournalActivity(day)
  const daysData = useJournalDays("2000-01-01", "2099-12-31", section === "journal").data

  const [loadedDay, setLoadedDay] = useState<string | null>(null)
  const [openPopover, setOpenPopover] = useState(false)
  const [mode, setMode] = useState<"editor" | "calendar">("editor")
  // AI assist preview: which action is being streamed into the panel
  const assist = useEditorAssist()
  const [assistView, setAssistView] = useState<AssistAction | null>(null)
  const assistSourceRef = useRef<string>("")
  // markdown baseline after the last load: setContent-driven updates must not re-save
  const baselineMdRef = useRef<string>("")
  const saveTimer = useRef<number | null>(null)
  // payload frozen at schedule time so a day switch can never redirect it
  const pendingSave = useRef<{ day: string; md: string; mood: number | null; energy: number | null } | null>(null)

  // debounced saves must never capture stale day/ratings; refs mirror latest state
  const moodRef = useRef(mood)
  moodRef.current = mood
  const energyRef = useRef(energy)
  energyRef.current = energy
  const saveRef = useRef(save)
  saveRef.current = save
  const queryClient = useQueryClient()

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, breaks: true }),
      Placeholder.configure({ placeholder: "Start writing… type / for blocks" }),
      SlashCommands.configure({
        onActivity: (ed) => {
          void insertActivity(ed)
        },
        onAI: (ed, action) => {
          void runAssist(ed, action)
        },
      }),
    ],
    content: "",
    onUpdate: ({ editor }) => scheduleSave(editor),
  })

  function scheduleSave(
    ed: NonNullable<ReturnType<typeof useEditor>>,
    force = false,
    overrides?: { mood?: number | null; energy?: number | null },
  ) {
    const md = getMarkdown(ed)
    if (!force && md === baselineMdRef.current) return // programmatic setContent, not a user edit
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    // React state updates are async: a rating click must pass its new value in
    // explicitly — moodRef/energyRef still hold the previous render's value here.
    pendingSave.current = {
      day,
      md,
      mood: overrides && "mood" in overrides ? (overrides.mood ?? null) : moodRef.current,
      energy: overrides && "energy" in overrides ? (overrides.energy ?? null) : energyRef.current,
    }
    saveTimer.current = window.setTimeout(flushSave, 700)
  }

  /** Write the pending payload to its own day; call before any day switch. */
  function flushSave() {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = null
    const pending = pendingSave.current
    pendingSave.current = null
    if (!pending) return
    // never create empty entries: visiting a day must not pollute the journal
    const hasContent = pending.md.trim() || pending.mood !== null || pending.energy !== null
    if (!hasContent && queryClient.getQueryData(["journal", pending.day]) === null) return
    saveRef.current.mutate({
      day: pending.day,
      raw_markdown: pending.md,
      mood: pending.mood,
      energy: pending.energy,
    })
  }

  // pull day switch + rating changes into the next save
  useEffect(() => {
    setMood(entry.data?.mood ?? null)
    setEnergy(entry.data?.energy ?? null)
  }, [day, entry.data])

  // arriving from Second Brain: flush pending save to its own day, then jump
  useEffect(() => {
    if (journalDay && journalDay !== day) {
      flushSave()
      setDay(journalDay)
      useUi.setState({ journalDay: null })
    }
  }, [journalDay, day])

  // load stored markdown once per day
  useEffect(() => {
    if (!editor || loadedDay === day) return
    if (entry.data === undefined) return // still loading
    // a pending assist belongs to the day it was opened on — never let it land elsewhere
    setAssistView(null)
    assist.clear()
    const md = entry.data?.raw_markdown ?? ""
    editor.commands.setContent(md)
    baselineMdRef.current = getMarkdown(editor)
    setLoadedDay(day)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, entry.data, day, loadedDay])

  function shiftDay(delta: number) {
    flushSave()
    const d = new Date(`${day}T12:00:00`)
    d.setDate(d.getDate() + delta)
    setDay(toDayParam(d))
  }

  async function insertActivity(ed = editor) {
    if (!ed) return
    const fresh = await activity.refetch()
    if (!fresh.data) {
      toast.error("Couldn't load day activity")
      return
    }
    const current = getMarkdown(ed)
    const glue = current.trim().length === 0 ? "" : "\n\n"
    ed.commands.setContent(current + glue + buildActivityMarkdown(fresh.data))
  }

  function insertTemplate() {
    if (!editor) return
    const current = getMarkdown(editor)
    const glue = current.trim().length === 0 ? "" : "\n\n"
    editor.commands.setContent(current + glue + REFLECTION_TEMPLATE)
  }

  /** Whole-entry AI assist; streams into the preview panel (see AssistPanel). */
  async function runAssist(ed: Editor | null, action: AssistAction) {
    if (!ed || assist.pending) return
    const source = getMarkdown(ed)
    if (!source.trim()) {
      toast.error("Nothing to assist yet — write something first")
      return
    }
    assistSourceRef.current = source // accept() compares against this
    setAssistView(action)
    await assist.run(action, source)
  }

  function acceptAssist() {
    if (!editor || !assistView || assist.text == null) return
    const md = assist.text.trim()
    if (!md) {
      toast.error("The AI returned nothing")
      return
    }
    if (getMarkdown(editor) !== assistSourceRef.current) {
      // the entry changed while the AI was streaming — refuse to clobber it
      toast.error("The entry changed while the AI was working — discard and retry")
      return
    }
    const current = getMarkdown(editor)
    const glue = current.trim().length === 0 || assistView !== "continue" ? "" : "\n\n"
    const next = assistView === "continue" ? current + glue + md : md
    // setContent fires onUpdate -> scheduleSave; the changed markdown saves for real.
    editor.commands.setContent(next)
    baselineMdRef.current = getMarkdown(editor)
    setAssistView(null)
    assist.clear()
    toast.success(assistView === "continue" ? "Continuation added" : "Entry updated")
  }

  function discardAssist() {
    setAssistView(null)
    assist.clear()
  }

  const dateLabel = useMemo(
    () =>
      new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    [day],
  )
  const isToday = day === toDayParam(new Date())

  if (section !== "journal") return null

  return (
    <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pt-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={() => shiftDay(-1)} aria-label="Previous day">
          <ChevronLeft />
        </Button>
        <Popover open={openPopover} onOpenChange={setOpenPopover}>
          <PopoverTrigger
            render={
              <button
                className="rounded-lg px-2 py-1 text-lg font-semibold tracking-tight transition-colors hover:bg-accent"
                aria-label="Browse journal days"
              />
            }
          >
            {dateLabel}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-3">
            <MiniMonth
              entries={daysData ?? []}
              selected={day}
              onSelect={(d) => {
                flushSave()
                setDay(d)
                setOpenPopover(false)
              }}
            />
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="icon-sm" onClick={() => shiftDay(1)} aria-label="Next day">
          <ChevronRight />
        </Button>
        {!isToday && (
          <Button variant="outline" size="xs" onClick={() => setDay(toDayParam(new Date()))}>
            Today
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {save.isPending ? (
            "Saving…"
          ) : save.isError ? (
            <span className="text-destructive">Save failed</span>
          ) : save.data?.saved === true ? (
            <span className="flex items-center gap-1">
              <Check className="size-3 text-positive" /> Saved
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-0.5 self-start rounded-lg border border-[var(--glass-border)] p-0.5">
        {(["editor", "calendar"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              "rounded-md px-3 py-1 text-xs capitalize transition-colors",
              mode === m ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === "calendar" ? (
        <div className="mt-3">
          <JournalCalendar
            selected={day}
            onSelect={(d) => {
              flushSave()
              setDay(d)
              setMode("editor")
            }}
          />
        </div>
      ) : (
      <>
      <div className="glass mt-3 flex flex-col gap-2 rounded-2xl px-4 py-3">
        <RatingRow
          label="Mood"
          value={mood}
          onChange={(v) => {
            setMood(v)
            if (editor) scheduleSave(editor, true, { mood: v })
          }}
        />
        <RatingRow
          label="Energy"
          value={energy}
          onChange={(v) => {
            setEnergy(v)
            if (editor) scheduleSave(editor, true, { energy: v })
          }}
        />
      </div>
      <div className="glass mt-3 rounded-2xl px-5 py-4">
        <EditorContent editor={editor} />
      </div>

      {assistView && (
        <div className="glass mt-3 rounded-2xl border border-primary/30 px-5 py-4">
          <div className="flex items-center gap-2">
            <Wand2 className="size-4 text-primary" />
            <h3 className="text-sm font-semibold capitalize">AI {assistView}</h3>
            {assist.pending && <Sparkles className="size-3 animate-pulse text-primary" />}
            {!assist.pending && assist.error && (
              <span className="text-xs text-destructive">{assist.error}</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="xs" disabled={assist.pending} onClick={discardAssist}>
                <X /> Discard
              </Button>
              <Button variant="outline" size="xs" disabled={assist.pending || !assist.text?.trim()} onClick={acceptAssist}>
                <Check /> Accept
              </Button>
            </div>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed opacity-90">
            {assist.text?.trim() || <span className="text-muted-foreground">Working on your entry…</span>}
          </p>
        </div>
      )}

      <DailyReviewCard day={day} />

      <div className="mt-3 flex items-center gap-2 pb-8 text-xs">
        <Button variant="outline" size="xs" onClick={() => void insertActivity()}>
          <ListChecks /> Day activity
        </Button>
        <Button variant="outline" size="xs" onClick={insertTemplate}>
          <Sparkles /> Reflection template
        </Button>
        {entry.data && (
          <span className="ml-auto text-muted-foreground">
            {entry.data.tasks_done}/{entry.data.tasks_planned || "–"} tasks ·{" "}
            {formatDuration(Math.round(entry.data.hours_deep_work * 60))} focus
          </span>
        )}
      </div>
      </>
      )}
    </div>
  </main>
  )
}
