import { useEffect, type ReactNode } from "react"
import { Check, CheckCircle2, Link2, Minus, Pause, Play, Plus, RotateCcw, Timer, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useFocusTimer } from "@/stores/timer"
import { useCreateSession, useTasks } from "@/hooks/api"
import { toast } from "sonner"
import { cn } from "cn"

const RING_RADIUS = 46
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

/** Circular countdown; `fraction` 0..1 is the remaining sweep. */
function ProgressRing({ fraction, colored, children }: { fraction: number; colored: boolean; children: ReactNode }) {
  return (
    <div className="relative size-28">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={RING_RADIUS} fill="none" strokeWidth="5" className="stroke-border/60" />
        <circle
          cx="50"
          cy="50"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          className={cn("transition-[stroke-dashoffset] duration-1000 ease-linear", colored ? "stroke-primary" : "stroke-positive")}
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, fraction)))}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">{children}</div>
    </div>
  )
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

  const activeTask = (tasks.data ?? []).find((t) => t.id === timer.taskId)
  const openTasks = (tasks.data ?? []).filter((t) => t.status !== "completed" && t.status !== "canceled")
  const display = timer.mode === "pomodoro" ? mmss(timer.secondsLeft) : mmss(timer.elapsed)
  const phaseLabel = timer.mode === "pomodoro" ? (timer.phase === "work" ? "Focus" : "Break") : "Stopwatch"
  const inBreak = timer.mode === "pomodoro" && timer.phase === "break"

  // mirror the countdown into the window title while it runs
  useEffect(() => {
    if (timer.open && timer.running) {
      document.title = `${display} · ${phaseLabel}`
    } else {
      document.title = "Meditations"
    }
  }, [timer.open, timer.running, display, phaseLabel])

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

  const ringFraction =
    timer.mode === "pomodoro"
      ? timer.secondsLeft / ((timer.phase === "work" ? timer.workMinutes : timer.breakMinutes) * 60)
      : 1

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
            aria-pressed={timer.mode === id}
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

      <div className="mt-2 flex justify-center">
        <ProgressRing fraction={ringFraction} colored={!inBreak}>
          <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums">{display}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                inBreak ? "bg-positive" : timer.mode === "stopwatch" && timer.running ? "animate-pulse bg-low" : timer.mode === "stopwatch" ? "bg-muted-foreground" : "bg-primary",
              )}
            />
            {phaseLabel}
          </span>
        </ProgressRing>
      </div>

      <div className="mt-2 flex items-center justify-center gap-2">
        <Button
          variant={timer.running ? "secondary" : "default"}
          size="sm"
          className="min-w-24"
          onClick={() => (timer.mode === "stopwatch" && timer.running ? stopStopwatch() : timer.running ? timer.pause() : timer.start())}
        >
          {timer.mode === "stopwatch" && timer.running ? <CheckCircle2 /> : timer.running ? <Pause /> : <Play />}
          {timer.mode === "stopwatch" && timer.running ? "Log & stop" : timer.running ? "Pause" : "Start"}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={timer.reset} aria-label={`Reset ${timer.mode === "pomodoro" ? "timer" : "stopwatch"}`}>
          <RotateCcw />
        </Button>
      </div>

      {timer.mode === "pomodoro" && (
        <div className="mt-2 space-y-1">
          {(
            [
              { label: "Focus", value: timer.workMinutes, setValue: timer.setWorkMinutes, min: 5, max: 90 },
              { label: "Break", value: timer.breakMinutes, setValue: timer.setBreakMinutes, min: 1, max: 30 },
            ] as const
          ).map(({ label, value, setValue, min, max }) => (
            <div key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-10">{label}</span>
              <span className="w-8 text-right font-medium tabular-nums text-foreground">{value}m</span>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={timer.running || value <= min}
                onClick={() => setValue(value - 5)}
                aria-label={`Shorter ${label.toLowerCase()}`}
              >
                <Minus />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={timer.running || value >= max}
                onClick={() => setValue(value + 5)}
                aria-label={`Longer ${label.toLowerCase()}`}
              >
                <Plus />
              </Button>
            </div>
          ))}
        </div>
      )}

      {(openTasks.length > 0 || timer.taskId) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="sm" className="mt-1.5 w-full justify-start text-xs text-muted-foreground" aria-label="Linked task" />
            }
          >
            <Link2 className="size-3.5" />
            <span className="truncate">{activeTask ? activeTask.title : "Link a task"}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-64 w-60 overflow-y-auto">
            <DropdownMenuItem onClick={() => timer.setTask(null)}>
              <span className="flex-1 truncate">No linked task</span>
              {timer.taskId === null && <Check className="size-3.5" />}
            </DropdownMenuItem>
            {openTasks.slice(0, 50).map((t) => (
              <DropdownMenuItem key={t.id} onClick={() => timer.setTask(t.id)}>
                <span className="flex-1 truncate">{t.title}</span>
                {timer.taskId === t.id && <Check className="size-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
