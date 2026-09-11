import { useState } from "react"
import { Activity, Brain, CalendarRange, Flame, ListChecks, TrendingDown, TrendingUp, Timer, Minus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { BarsChart, LineChart, type Point } from "@/components/charts"
import { useInsights } from "@/hooks/api"
import { formatDuration } from "@/lib/dates"
import { cn } from "cn"

const PERIODS = [14, 30, 90] as const

function TrendBadge({ value, prev }: { value: number; prev: number | null }) {
  if (prev === null) return null
  const delta = value - prev
  if (Math.abs(delta) < 1) {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <Minus className="size-3" /> flat
      </Badge>
    )
  }
  const up = delta > 0
  return (
    <Badge variant="outline" className={cn("gap-1", up ? "text-emerald-400" : "text-red-400")}>
      {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {up ? "+" : ""}
      {delta.toFixed(1)} vs prev week
    </Badge>
  )
}

function StatCard({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: React.ReactNode; icon: typeof Activity }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs">{sub}</div>}
    </div>
  )
}

function TrendArrow({ trend }: { trend: string }) {
  if (trend === "rising") return <TrendingUp className="size-3.5 text-emerald-400" />
  if (trend === "declining") return <TrendingDown className="size-3.5 text-red-400" />
  return <Minus className="size-3.5 text-muted-foreground" />
}

export function InsightsView() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(30)
  const data = useInsights(period, true)

  if (data.isError) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 pt-5">
        <p className="pt-16 text-center text-sm text-red-400">Couldn't load insights — is the backend running?</p>
      </main>
    )
  }

  const series = data.data?.series ?? []
  const totals = data.data?.totals
  const targetHours = totals?.target_deep_work_hours ?? 4

  const scorePoints: Point[] = series.map((s, i) => ({
    x: series.length === 1 ? 0.5 : i / (series.length - 1),
    y: Math.max(0, Math.min(1, s.score / 100)),
    label: s.date,
  }))
  const focusPoints = series.map((s) => s.deep_work_hours)
  const maxFocus = Math.max(targetHours, ...focusPoints, 1)
  const moodPoints: Point[] = series
    .filter((s) => s.mood !== null)
    .map((s) => ({
      x: series.indexOf(s) / Math.max(1, series.length - 1),
      y: s.mood! / 5,
    }))

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto overflow-x-hidden px-6 pt-5 pb-10 min-h-0">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Insights</h1>
        <div className="glass ml-auto flex items-center gap-0.5 rounded-lg p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                period === p ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      {/* stat row */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Avg score (7d)"
          value={totals ? totals.avg_score_7.toFixed(1) : "…"}
          icon={Activity}
          sub={totals && <TrendBadge value={totals.avg_score_7} prev={totals.avg_score_prev_7} />}
        />
        <StatCard
          label="Completion rate"
          value={totals ? `${Math.round(totals.completion_rate * 100)}%` : "…"}
          icon={ListChecks}
          sub={totals && <span className="text-muted-foreground">{totals.tasks_done} tasks done</span>}
        />
        <StatCard
          label="Deep work"
          value={totals ? formatDuration(Math.round(totals.total_focus_hours * 60)) : "…"}
          icon={Timer}
          sub={totals && <span className="text-muted-foreground">target {formatDuration(Math.round(targetHours * 60))}/day</span>}
        />
        <StatCard
          label="Journaling streak"
          value={data.data ? `${data.data.journaling_streak}d` : "…"}
          icon={Flame}
          sub={data.data && <span className="text-muted-foreground">best {data.data.journaling_best}d</span>}
        />
      </div>

      {/* score chart */}
      <div className="glass mt-4 rounded-2xl p-4">
        <h2 className="text-sm font-semibold">Daily score</h2>
        <p className="text-[11px] text-muted-foreground">
          0.40·tasks + 0.35·focus + 0.15·habits + AI nudge (plan §3.4); AI-reviewed days include the ±10 nudge
        </p>
        <div className="mt-2">
          <LineChart points={scorePoints} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{series[0]?.date}</span>
          <span>{series[series.length - 1]?.date}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* focus chart */}
        <div className="glass rounded-2xl p-4">
          <h2 className="text-sm font-semibold">Deep work per day</h2>
          <div className="mt-2">
            <BarsChart values={focusPoints} max={maxFocus} targetRatio={targetHours / maxFocus} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">dashed line = daily target</p>
        </div>

        {/* mood */}
        <div className="glass rounded-2xl p-4">
          <h2 className="text-sm font-semibold">Mood</h2>
          <div className="mt-2">
            <LineChart points={moodPoints} color="oklch(0.75 0.15 160)" showGrid={false} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">from journal entries (1–5)</p>
        </div>
      </div>

      {/* habits + rollups */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="glass rounded-2xl p-4">
          <h2 className="text-sm font-semibold">Habits</h2>
          {(data.data?.habits ?? []).length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">No daily habits configured yet.</p>
          ) : (
            <div className="mt-3 space-y-2.5">
              {(data.data?.habits ?? []).map((h) => (
                <div key={h.id} className="flex items-center gap-2 text-sm">
                  <Flame className={cn("size-3.5", h.current_streak > 0 ? "text-amber-400" : "text-muted-foreground/40")} />
                  <span className="truncate">{h.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{h.current_streak}d streak</span>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {Math.round(h.rate_30 * 100)}% (30d)
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="glass rounded-2xl p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <CalendarRange className="size-4 text-primary" /> Rollup trends
          </h2>
          {(data.data?.weekly ?? []).length === 0 && (data.data?.monthly ?? []).length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No weekly/monthly rollups yet — they're generated by the AI agents (daily review → weekly → monthly).
            </p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {(data.data?.weekly ?? []).map((w) => (
                <div key={w.week_start} className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-muted-foreground">Week of {w.week_start.slice(5)}</span>
                  <TrendArrow trend={w.trend} />
                  <span className="ml-auto font-medium tabular-nums">{w.avg_score.toFixed(1)}</span>
                </div>
              ))}
              {(data.data?.monthly ?? []).map((m) => (
                <div key={m.month} className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-muted-foreground">{m.month}</span>
                  <TrendArrow trend={m.trend} />
                  <span className="ml-auto font-medium tabular-nums">{m.avg_score.toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Brain className="size-3" /> Run "AI review" in the journal to persist scores with the LLM nudge; everything
        else here is computed deterministically from your telemetry.
      </p>
    </main>
  )
}
