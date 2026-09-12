import { useMemo, useState } from "react"
import { Brain, Keyboard, ListFilter, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCapture } from "@/hooks/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { useCreateList, useCreateTask, useLists } from "@/hooks/api"
import { parseQuickAdd } from "@/lib/parsing"
import { formatDue, parseUTC } from "@/lib/dates"
import { useUi } from "@/stores/ui"
import { cn } from "cn"

const PRIORITY_LABELS: Record<number, string> = { 3: "High", 2: "Medium", 1: "Low", 0: "No priority" }

function SyntaxHelp() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label="Quick add syntax" className="text-muted-foreground" />
        }
      >
        <Keyboard />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 text-sm">
        <p className="font-medium">Quick add shorthand</p>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          <li>
            <code className="text-foreground">tomorrow 5pm</code>, <code className="text-foreground">next mon</code>,{" "}
            <code className="text-foreground">sep 20 3pm</code> — due date
          </li>
          <li>
            <code className="text-foreground">every mon, wed</code>,{" "}
            <code className="text-foreground">every weekday</code> — repeat
          </li>
          <li>
            <code className="text-foreground">!1</code> high · <code className="text-foreground">!2</code> med ·{" "}
            <code className="text-foreground">!3</code> low
          </li>
          <li>
            <code className="text-foreground">#list</code> · <code className="text-foreground">@tag</code>
          </li>
          <li>
            <code className="text-foreground">~45m</code>, <code className="text-foreground">~1h30m</code> — estimate
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Example: <span className="text-foreground">Review Q3 budget tomorrow 3pm !1 #finance @urgent ~45m</span>
        </p>
      </PopoverContent>
    </Popover>
  )
}

function CaptureDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [text, setText] = useState("")
  const capture = useCapture()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[32rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="size-4 text-primary" /> Brain dump
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Paste or dictate anything — the AI extracts tasks with due dates and adds a snippet to today's journal.
        </p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="e.g. Spoke with Alex. Need to email him the slide deck by Thursday 4pm and schedule team sync for Monday."
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={capture.isPending || !text.trim()}
            onClick={async () => {
              await capture.mutateAsync(text.trim())
              setText("")
              onOpenChange(false)
            }}
          >
            <Sparkles /> {capture.isPending ? "Capturing…" : "Capture"}
          </Button>
        </div>
        {capture.data && capture.data.tasks.length > 0 && (
          <div className="space-y-1 text-xs text-muted-foreground">
            {capture.data.tasks.map((t) => (
              <div key={t.id} className="truncate">
                + {t.title} {t.due_date ? `· due ${t.due_date.slice(0, 10)}` : ""}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function QuickAdd() {
  const [value, setValue] = useState("")
  const captureOpen = useUi((s) => s.captureOpen)
  const setCaptureOpen = useUi((s) => s.setCaptureOpen)
  const lists = useLists()
  const createTask = useCreateTask()
  const createList = useCreateList()

  const parsed = useMemo(() => parseQuickAdd(value), [value])
  const hasExtras =
    parsed.due_date !== null ||
    parsed.priority !== 0 ||
    parsed.tags.length > 0 ||
    parsed.list_name !== null ||
    parsed.estimated_minutes !== null ||
    parsed.recurrence_rule !== null

  const resolvedList = useMemo(() => {
    if (!parsed.list_name) return null
    return (
      lists.data?.find((l) => l.name.toLowerCase() === parsed.list_name!.toLowerCase()) ?? null
    )
  }, [lists.data, parsed.list_name])

  async function submit() {
    const title = parsed.title.trim()
    if (!title) return
    try {
      let listId = resolvedList?.id ?? null
      if (parsed.list_name && !listId) {
        const created = await createList.mutateAsync({ name: parsed.list_name })
        listId = created.id
      }
      await createTask.mutateAsync({
        title,
        list_id: listId,
        due_date: parsed.due_date,
        priority: parsed.priority,
        tags: parsed.tags,
        estimated_minutes: parsed.estimated_minutes,
        recurrence_rule: parsed.recurrence_rule,
      })
      setValue("")
    } catch {
      // toasts handled in mutation hooks
    }
  }

  const due = parsed.due_date ? parseUTC(parsed.due_date) : null

  return (
    <div className="px-6 pt-4">
      <div
        className={cn(
          "glass flex items-center gap-2 rounded-2xl px-3 py-2 shadow-lg shadow-black/20 transition-all",
          value && "ring-1 ring-primary/40",
        )}
      >
        <Sparkles className="size-4 shrink-0 text-primary" />
        <Input
          id="quick-add-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit()
            if (e.key === "Escape") setValue("")
          }}
          placeholder="Add a task…  try: buy milk tomorrow 5pm !1 #personal @errands ~10m"
          className="h-9 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setCaptureOpen(true)}
          aria-label="AI brain-dump capture"
          title="AI brain-dump capture"
        >
          <Brain />
        </Button>
        <SyntaxHelp />
      </div>
      <CaptureDialog open={captureOpen} onOpenChange={setCaptureOpen} />

      {value && hasExtras && (
        <div className="flex flex-wrap items-center gap-1.5 px-2 pt-2 text-xs">
          <ListFilter className="size-3 text-muted-foreground" />
          <span className="max-w-64 truncate font-medium">{parsed.title || "…"}</span>
          {due && <Badge variant="outline">{formatDue(due)}</Badge>}
          {parsed.priority !== 0 && <Badge variant="outline">{PRIORITY_LABELS[parsed.priority]}</Badge>}
          {parsed.list_name && (
            <Badge variant="outline" className="text-primary">
              #{parsed.list_name}
              {!resolvedList && " (new)"}
            </Badge>
          )}
          {parsed.tags.map((t) => (
            <Badge key={t} variant="outline" className="text-muted-foreground">
              @{t}
            </Badge>
          ))}
          {parsed.estimated_minutes !== null && (
            <Badge variant="outline" className="text-muted-foreground">
              ~{parsed.estimated_minutes}m
            </Badge>
          )}
          {parsed.recurrence_rule && <Badge variant="outline">↻ repeats</Badge>}
        </div>
      )}
    </div>
  )
}
