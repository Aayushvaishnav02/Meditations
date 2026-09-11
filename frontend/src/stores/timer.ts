import { create } from "zustand"
import { persist } from "zustand/middleware"

export type TimerMode = "pomodoro" | "stopwatch"
export type TimerPhase = "work" | "break"

interface FocusTimerState {
  mode: TimerMode
  phase: TimerPhase
  running: boolean
  secondsLeft: number // pomodoro countdown
  elapsed: number // stopwatch seconds
  workMinutes: number
  breakMinutes: number
  taskId: string | null
  open: boolean
  setMode: (mode: TimerMode) => void
  setTask: (taskId: string | null) => void
  setWorkMinutes: (n: number) => void
  setBreakMinutes: (n: number) => void
  start: () => void
  pause: () => void
  reset: () => void
  toggleOpen: () => void
  /** Advance the clock one second; returns a phase-completion signal. */
  tick: () => "work-done" | "break-done" | null
}

export const useFocusTimer = create<FocusTimerState>()(
  persist(
    (set, get) => ({
      mode: "pomodoro",
      phase: "work",
      running: false,
      secondsLeft: 25 * 60,
      elapsed: 0,
      workMinutes: 25,
      breakMinutes: 5,
      taskId: null,
      open: true,
      setMode: (mode) => {
        if (mode === get().mode) return
        set({ mode, running: false, elapsed: 0, phase: "work", secondsLeft: get().workMinutes * 60 })
      },
      setTask: (taskId) => set({ taskId }),
      setWorkMinutes: (n) => {
        const clamped = Math.max(5, Math.min(90, n))
        set((s) => ({
          workMinutes: clamped,
          secondsLeft: s.phase === "work" && !s.running ? clamped * 60 : s.secondsLeft,
        }))
      },
      setBreakMinutes: (n) => {
        const clamped = Math.max(1, Math.min(30, n))
        set((s) => ({
          breakMinutes: clamped,
          secondsLeft: s.phase === "break" && !s.running ? clamped * 60 : s.secondsLeft,
        }))
      },
      start: () => set({ running: true }),
      pause: () => set({ running: false }),
      reset: () =>
        set((s) => ({
          running: false,
          elapsed: 0,
          phase: "work",
          secondsLeft: s.workMinutes * 60,
        })),
      toggleOpen: () => set((s) => ({ open: !s.open })),
      tick: () => {
        const s = get()
        if (!s.running) return null
        if (s.mode === "stopwatch") {
          set({ elapsed: s.elapsed + 1 })
          return null
        }
        if (s.secondsLeft > 1) {
          set({ secondsLeft: s.secondsLeft - 1 })
          return null
        }
        if (s.phase === "work") {
          set({ phase: "break", secondsLeft: s.breakMinutes * 60, running: true })
          return "work-done"
        }
        set({ phase: "work", secondsLeft: s.workMinutes * 60, running: false })
        return "break-done"
      },
    }),
    {
      name: "journal-focus-timer",
      partialize: (s) => ({
        mode: s.mode,
        workMinutes: s.workMinutes,
        breakMinutes: s.breakMinutes,
        taskId: s.taskId,
        open: s.open,
      }),
      // a fresh page load starts paused; persisted countdowns are re-seeded
      onRehydrateStorage: () => (state) => {
        if (state) state.reset()
      },
    },
  ),
)
