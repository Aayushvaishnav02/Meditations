import { useState } from "react"
import { Coffee, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useBriefing } from "@/hooks/api"

/** Conversational daily planning brief (plan §6.3.3): Top 3 focus for today. */
export function BriefingCard() {
  const briefing = useBriefing()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null
  const data = briefing.data

  return (
    <div className="px-6">
      <div className="glass rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <Coffee className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Good morning — Top 3 for today</h2>
          {data && (
            <span className="ml-auto text-xs text-muted-foreground">
              {data.overdue_count} overdue · {data.due_today_count} due today
            </span>
          )}
          <button
            onClick={() => setDismissed(true)}
            className="ml-2 text-xs text-muted-foreground hover:text-foreground"
          >
            dismiss
          </button>
        </div>

        {briefing.isPending ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="size-3.5 animate-pulse" /> Reading your overdue work, today's tasks and yesterday's
            reflection…
          </p>
        ) : data ? (
          <div className="mt-3">
            <ol className="space-y-1.5">
              {data.top_focus.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
                    {i + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
            {data.reasoning && <p className="mt-2 text-xs text-muted-foreground">{data.reasoning}</p>}
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <Button variant="outline" size="xs" onClick={() => briefing.mutate()}>
              <Sparkles /> Generate
            </Button>
            <span className="text-[11px] text-muted-foreground">
              the AI picks three achievable priorities from your backlog
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
