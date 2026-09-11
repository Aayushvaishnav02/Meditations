import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { JournalDay } from "@/api/types"
import { cn } from "cn"

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"]

/** mood 1..5 -> red..green dot color; null mood -> neutral dot */
function moodDotClass(mood: number | null): string {
  if (mood === null) return "bg-primary"
  if (mood <= 2) return "bg-red-400"
  if (mood === 3) return "bg-amber-400"
  return "bg-emerald-400"
}

export function MiniMonth({
  entries,
  selected,
  onSelect,
}: {
  entries: JournalDay[]
  selected: string
  onSelect: (day: string) => void
}) {
  const [cursor, setCursor] = useState(() => {
    const [y, m] = selected.split("-").map(Number)
    return { year: y, month: m }
  })

  const { weeks, label, hasPrev } = useMemo(() => {
    const first = new Date(cursor.year, cursor.month - 1, 1)
    const gridStart = new Date(first)
    gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7)) // Monday start
    const entryDays = new Set(entries.map((e) => e.date))
    const weeks = Array.from({ length: 6 }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const day = new Date(gridStart)
        day.setDate(gridStart.getDate() + w * 7 + d)
        const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
        return { key, dayNum: day.getDate(), inMonth: day.getMonth() === cursor.month - 1, hasEntry: entryDays.has(key), entry: entries.find((e) => e.date === key) }
      }),
    )
    const prevMonth = new Date(cursor.year, cursor.month - 2, 1)
    return {
      weeks,
      label: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      hasPrev: entries.some((e) => {
        const d = new Date(`${e.date}T12:00:00`)
        return d < prevMonth
      }),
    }
  }, [entries, cursor])

  function shift(delta: number) {
    setCursor((c) => (c.month + delta === 0 ? { year: c.year - 1, month: 12 } : c.month + delta === 13 ? { year: c.year + 1, month: 1 } : { year: c.year, month: c.month + delta }))
  }

  return (
    <div className="w-64 select-none">
      <div className="mb-1 flex items-center">
        <span className="text-xs font-semibold">{label}</span>
        <div className="ml-auto flex gap-0.5">
          <Button variant="ghost" size="icon-xs" disabled={!hasPrev} onClick={() => shift(-1)} aria-label="Earlier month">
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={() => shift(1)} aria-label="Later month">
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="text-[10px] text-muted-foreground">
            {w}
          </span>
        ))}
        {weeks.flat().map(({ key, dayNum, inMonth, hasEntry, entry }, i) => (
          <button
            key={i}
            onClick={() => onSelect(key)}
            title={hasEntry ? `${key}${entry?.mood ? ` · mood ${entry.mood}/5` : ""}` : key}
            className={cn(
              "relative mx-auto flex size-7 items-center justify-center rounded-md text-xs transition-colors",
              inMonth ? "text-foreground" : "text-muted-foreground/40",
              key === selected && "bg-primary text-primary-foreground",
              key !== selected && "hover:bg-accent",
            )}
          >
            {dayNum}
            {hasEntry && key !== selected && (
              <span className={cn("absolute bottom-0.5 size-1 rounded-full", moodDotClass(entry?.mood ?? null))} />
            )}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        <span className="mr-1 inline-block size-1 rounded-full bg-primary align-middle" /> journaled · colors = mood
      </p>
    </div>
  )
}
