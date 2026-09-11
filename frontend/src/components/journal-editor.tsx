import { useEffect, useMemo, useRef, useState } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { Markdown } from "tiptap-markdown"
import { Check, ChevronLeft, ChevronRight, ListChecks, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useJournalActivity, useJournalEntry, useSaveJournal } from "@/hooks/api"
import { SlashCommands } from "@/components/slash-command"
import { formatDuration } from "@/lib/dates"
import { useUi } from "@/stores/ui"
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
                : "border-white/15 hover:border-white/40",
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

  const [loadedDay, setLoadedDay] = useState<string | null>(null)
  const saveTimer = useRef<number | null>(null)

  // debounced saves must never capture stale day/ratings; refs mirror latest state
  const dayRef = useRef(day)
  dayRef.current = day
  const moodRef = useRef(mood)
  moodRef.current = mood
  const energyRef = useRef(energy)
  energyRef.current = energy
  const saveRef = useRef(save)
  saveRef.current = save

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
      }),
    ],
    content: "",
    onUpdate: ({ editor }) => scheduleSave(editor),
  })

  function scheduleSave(ed: NonNullable<ReturnType<typeof useEditor>>) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const md = getMarkdown(ed)
      saveRef.current.mutate({
        day: dayRef.current,
        raw_markdown: md,
        mood: moodRef.current,
        energy: energyRef.current,
      })
    }, 700)
  }

  // pull day switch + rating changes into the next save
  useEffect(() => {
    setMood(entry.data?.mood ?? null)
    setEnergy(entry.data?.energy ?? null)
  }, [day, entry.data])

  // arriving from Second Brain: jump to the requested day (consumed once)
  useEffect(() => {
    if (journalDay && journalDay !== day) {
      setDay(journalDay)
      useUi.setState({ journalDay: null })
    }
  }, [journalDay, day])

  // load stored markdown once per day
  useEffect(() => {
    if (!editor || loadedDay === day) return
    if (entry.data === undefined) return // still loading
    const md = entry.data?.raw_markdown ?? ""
    editor.commands.setContent(md)
    setLoadedDay(day)
  }, [editor, entry.data, day, loadedDay])

  function shiftDay(delta: number) {
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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pt-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={() => shiftDay(-1)} aria-label="Previous day">
          <ChevronLeft />
        </Button>
        <h1 className="text-lg font-semibold tracking-tight">{dateLabel}</h1>
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
            <span className="text-red-400">Save failed</span>
          ) : save.data ? (
            <span className="flex items-center gap-1">
              <Check className="size-3 text-emerald-400" /> Saved
            </span>
          ) : null}
        </div>
      </div>

      <div className="glass mt-3 flex flex-col gap-2 rounded-2xl px-4 py-3">
        <RatingRow label="Mood" value={mood} onChange={(v) => { setMood(v); if (editor) scheduleSave(editor) }} />
        <RatingRow label="Energy" value={energy} onChange={(v) => { setEnergy(v); if (editor) scheduleSave(editor) }} />
      </div>
      <div className="glass mt-3 rounded-2xl px-5 py-4">
        <EditorContent editor={editor} />
      </div>

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
    </main>
  )
}
