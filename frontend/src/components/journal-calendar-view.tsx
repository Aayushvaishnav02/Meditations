import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useJournalDays } from "@/hooks/api"
import { cn } from "cn"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** mood 1..5 -> red..amber..green; no mood -> primary (theme-aware tokens) */
function moodClass(mood: number | null): string {
  if (mood === null) return "bg-primary"
  if (mood <= 2) return "bg-overdue"
  if (mood === 3) return "bg-medium"
  return "bg-positive"
}

function localDayParam(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * Calendar view over the journal history (month grid, mood-colored dots).
 * Clicking a day opens the editor for it.
 */
export function JournalCalendar({
  selected,
  onSelect,
}: {
  selected: string
  onSelect: (day: string) => void
}) {
  const [cursor, setCursor] = useState(() => {
    const [y, m] = selected.split("-").map(Number)
    return { year: y, month: m }
  })
  const days = useJournalDays("2000-01-01", "2099-12-31", true)

  const weeks = useMemo(() => {
    const first = new Date(cursor.year, cursor.month - 1, 1)
    const gridStart = new Date(first)
    gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7)) // Monday start
    const byDay = new Map((days.data ?? []).map((e) => [e.date, e]))
    return Array.from({ length: 6 }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const day = new Date(gridStart)
        day.setDate(gridStart.getDate() + w * 7 + d)
        const key = localDayParam(day)
        return { key, dayNum: day.getDate(), inMonth: day.getMonth() === cursor.month - 1, entry: byDay.get(key) }
      }),
    )
  }, [cursor, days.data])

  function shift(delta: number) {
    setCursor((c) =>
      c.month + delta === 0
        ? { year: c.year - 1, month: 12 }
        : c.month + delta === 13
          ? { year: c.year + 1, month: 1 }
          : { year: c.year, month: c.month + delta },
    )
  }

  const label = new Date(cursor.year, cursor.month - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  })
  const journaled = (days.data ?? []).length

  return (
    <div className="px-6 pb-10">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-base font-semibold">{label}</h2>
        <Button variant="ghost" size="icon-xs" onClick={() => shift(-1)} aria-label="Previous month">
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={() => shift(1)} aria-label="Next month">
          <ChevronRight />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={() => { const t = new Date(); setCursor({ year: t.getFullYear(), month: t.getMonth() + 1 }) }} aria-label="Current month">
          <span className="text-xs">Today</span>
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{journaled} journaled days</span>
      </div>

      <div className="grid grid-cols-7 gap-1 px-1 pb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {weeks.flat().map(({ key, dayNum, inMonth, entry }, i) => (
          <button
            key={i}
            onClick={() => onSelect(key)}
            className={cn(
              "flex min-h-24 flex-col rounded-xl border p-2 text-left transition-all",
              inMonth ? "border-[var(--glass-border)] bg-[var(--glass-bg)]" : "border-transparent opacity-40",
              key === selected && "ring-1 ring-primary/50",
              "hover:border-primary/40",
            )}
          >
            <div className="flex w-full items-center gap-1.5">
              <span
                className={cn(
                  "text-xs",
                  key === localDayParam(new Date()) && "flex size-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground",
                )}
              >
                {dayNum}
              </span>
              {entry && (
                <span className={cn("size-2 rounded-full", moodClass(entry.mood))} title={entry.mood ? `mood ${entry.mood}/5` : "journaled"} />
              )}
            </div>
            {entry && (
              <div className="mt-1 flex flex-col gap-0.5">
                {entry.mood !== null && <span className="text-[10px] text-muted-foreground">mood {entry.mood}/5</span>}
                {entry.energy !== null && <span className="text-[10px] text-muted-foreground">energy {entry.energy}/5</span>}
                <span className="text-[10px] text-primary/80">open entry →</span>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
