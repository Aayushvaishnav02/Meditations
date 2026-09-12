import { Bot, Gauge, ListChecks, Sparkles, Timer } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useDailyRollupStream, useDailyScore } from "@/hooks/api"
import { formatDuration } from "@/lib/dates"
import { cn } from "cn"

/**
 * The deterministic score + the AI's qualitative layer (plan §3.4/§6.3.1):
 * breakdown is always live; "Run AI review" streams the rollup (partial
 * feedback appears as it generates) and persists the final ±10-nudged score.
 */
export function DailyReviewCard({ day }: { day: string }) {
  const score = useDailyScore(day, true)
  const rollup = useDailyRollupStream()

  const live = rollup.partial?.day === day ? rollup.partial.output : null // streamed, this day only
  const m = score.data?.metrics

  return (
    <div className="glass mt-3 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Gauge className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Day score</h2>
        {score.data && (
          <Badge variant="outline" className="text-xs">
            {score.data.persisted ? "AI-reviewed" : "live telemetry"}
          </Badge>
        )}
        <span className="ml-auto text-2xl font-semibold tabular-nums">
          {score.data ? score.data.final_score.toFixed(1) : "…"}
        </span>
      </div>

      {m && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1">
            <ListChecks className="size-3" /> {m.tasks_completed}/{m.tasks_planned || "–"} tasks
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Timer className="size-3" /> {formatDuration(Math.round(m.deep_work_hours * 60))} of{" "}
            {formatDuration(Math.round((score.data?.target_deep_work_hours ?? 4) * 60))}
          </Badge>
          {m.habits_scheduled > 0 && (
            <Badge variant="outline" className="gap-1">
              {m.habits_completed}/{m.habits_scheduled} habits
            </Badge>
          )}
          {(score.data?.llm_nudge ?? live?.llm_nudge) !== 0 && (
            <Badge variant="outline" className="gap-1 text-primary">
              nudge {(score.data?.llm_nudge ?? live?.llm_nudge ?? 0) > 0 ? "+" : ""}
              {(score.data?.llm_nudge ?? live?.llm_nudge ?? 0).toFixed(1)}
            </Badge>
          )}
        </div>
      )}

      {live?.feedback && <p className="mt-3 text-sm leading-relaxed opacity-80">{live.feedback}</p>}
      {live?.key_insight && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-primary/90">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          {live.key_insight}
        </p>
      )}
      {!live && score.data?.feedback && <p className="mt-3 text-sm leading-relaxed">{score.data.feedback}</p>}
      {!live && score.data?.insight && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-primary/90">
          <Sparkles className="mt-0.5 size-3.5 shrink-0" />
          {score.data.insight}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="xs" disabled={rollup.pending} onClick={() => rollup.review(day)}>
          <Bot className={cn(rollup.pending && "animate-pulse")} />
          {rollup.pending ? "Reviewing…" : "Run AI review"}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          sends today's entry to your AI provider; adjusts the score by at most ±10
        </span>
      </div>
      {rollup.error && <p className="mt-2 text-xs text-destructive">AI review failed: {rollup.error}</p>}
    </div>
  )
}
