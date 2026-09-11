import { useEffect } from "react"
import { CheckCircle2, Pause, Play, Plus, RotateCcw, Timer, X, Minus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFocusTimer } from "@/stores/timer"
import { useCreateSession, useTasks } from "@/hooks/api"
import { toast } from "sonner"
import { cn } from "cn"

function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export function FocusTimer() {
  const timer = useFocusTimer()
  const tasks = useTasks()
  const recordSession = useCreateSession()

  // drive the clock while running; phase transitions log sessions
  useEffect(() => {
    if (!timer.running) return
    const id = window.setInterval(() => {
      const signal = useFocusTimer.getState().tick()
      if (signal === "work-done") {
        const { workMinutes, taskId } = useFocusTimer.getState()
        recordSession.mutate({ task_id: taskId, duration_minutes: workMinutes, session_type: "pomodoro" })
        toast.success(`Pomodoro complete — ${workMinutes}m logged`)
      } else if (signal === "break-done") {
        toast("Break over — ready for the next one")
      }
    }, 1000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.running])

  function stopStopwatch() {
    const { elapsed, taskId } = useFocusTimer.getState()
    if (elapsed >= 60) {
      const minutes = Math.max(1, Math.round(elapsed / 60))
      recordSession.mutate({ task_id: taskId, duration_minutes: minutes, session_type: "stopwatch" })
      toast.success(`Stopwatch stopped — ${minutes}m logged`)
    } else if (elapsed > 0) {
      toast("Under a minute — nothing logged")
    }
    timer.reset()
  }

  if (!timer.open) {
    return (
      <Button
        onClick={timer.toggleOpen}
        aria-label="Open focus timer"
        className="glass fixed right-5 bottom-5 z-40 size-11 rounded-full shadow-lg shadow-black/30"
        size="icon"
      >
        <Timer />
      </Button>
    )
  }

  const activeTask = (tasks.data ?? []).find((t) => t.id === timer.taskId)
  const openTasks = (tasks.data ?? []).filter((t) => t.status !== "completed" && t.status !== "canceled")
  const display =
    timer.mode === "pomodoro" ? mmss(timer.secondsLeft) : mmss(timer.elapsed)
  const phaseLabel = timer.mode === "pomodoro" ? (timer.phase === "work" ? "Focus" : "Break") : "Stopwatch"

  return (
    <div className="glass fixed right-5 bottom-5 z-40 w-64 rounded-2xl p-3 shadow-xl shadow-black/30">
      <div className="flex items-center gap-1">
        {(
          [
            { id: "pomodoro", label: "Pomodoro" },
            { id: "stopwatch", label: "Stopwatch" },
          ] as const
        ).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => timer.setMode(id)}
            className={cn(
              "rounded-md px-2 py-1 text-xs transition-colors",
              timer.mode === id ? "bg-primary/20 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
        <Button variant="ghost" size="icon-xs" onClick={timer.toggleOpen} aria-label="Hide timer" className="ml-auto">
          <X />
        </Button>
      </div>

      <div className="mt-2 flex items-center justify-center gap-3">
        {timer.mode === "pomodoro" && timer.phase === "work" && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => timer.setWorkMinutes(timer.workMinutes - 5)}
            aria-label="Shorter pomodoro"
          >
            <Minus />
          </Button>
        )}
        <span className="font-mono text-3xl font-semibold tracking-tight tabular-nums">{display}</span>
        {timer.mode === "pomodoro" && timer.phase === "work" && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => timer.setWorkMinutes(timer.workMinutes + 5)}
            aria-label="Longer pomodoro"
          >
            <Plus />
          </Button>
        )}
      </div>

      <div className="mt-1 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <span
          className={cn(
            "size-1.5 rounded-full",
            timer.mode === "pomodoro" && (timer.phase === "break" ? "bg-emerald-400" : "bg-primary"),
            timer.mode === "stopwatch" && timer.running && "animate-pulse bg-sky-400",
            timer.mode === "stopwatch" && !timer.running && "bg-muted-foreground",
          )}
        />
        {phaseLabel}
        {activeTask && <span className="max-w-32 truncate opacity-80">· {activeTask.title}</span>}
      </div>

      <div className="mt-2 flex items-center justify-center gap-2">
        {timer.mode === "pomodoro" ? (
          <>
            <Button
              variant={timer.running ? "secondary" : "default"}
              size="sm"
              onClick={() => (timer.running ? timer.pause() : timer.start())}
            >
              {timer.running ? <Pause /> : <Play />}
              {timer.running ? "Pause" : "Start"}
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={timer.reset} aria-label="Reset timer">
              <RotateCcw />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant={timer.running ? "secondary" : "default"}
              size="sm"
              onClick={() => (timer.running ? stopStopwatch() : timer.start())}
            >
              {timer.running ? <CheckCircle2 /> : <Play />}
              {timer.running ? "Log & stop" : "Start"}
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={timer.reset} aria-label="Reset stopwatch">
              <RotateCcw />
            </Button>
          </>
        )}
      </div>

      {openTasks.length > 0 && (
        <select
          value={timer.taskId ?? ""}
          onChange={(e) => timer.setTask(e.target.value || null)}
          aria-label="Track a task"
          className="mt-2 w-full rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-muted-foreground outline-none focus:border-primary/50"
        >
          <option value="">No linked task</option>
          {openTasks.slice(0, 50).map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
