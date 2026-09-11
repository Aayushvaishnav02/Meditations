import { AlertCircle } from "lucide-react"
import { FocusTimer } from "@/components/focus-timer"
import { Header } from "@/components/header"
import { JournalView } from "@/components/journal-editor"
import { KanbanBoard } from "@/components/kanban-board"
import { QuickAdd } from "@/components/quick-add"
import { SecondBrain } from "@/components/second-brain"
import { Sidebar } from "@/components/sidebar"
import { TaskSections } from "@/components/task-sections"
import { useLists, useTasks } from "@/hooks/api"
import { useUi } from "@/stores/ui"
import { Button } from "@/components/ui/button"

function TasksErrorBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 pt-24 text-center text-muted-foreground">
      <AlertCircle className="size-8 text-red-400" />
      <p className="text-sm">Can't reach the API. Is the backend running on port 8000?</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

export default function App() {
  const section = useUi((s) => s.section)
  const view = useUi((s) => s.view)
  const scope = useUi((s) => s.scope)
  const search = useUi((s) => s.search)
  const tasks = useTasks()
  const lists = useLists()

  return (
    <div className="flex h-dvh overflow-hidden text-foreground">
      <Sidebar />
      {section === "journal" ? (
        <JournalView />
      ) : section === "second_brain" ? (
        <SecondBrain />
      ) : (
        <main className="flex min-w-0 flex-1 flex-col">
          <Header />
          <QuickAdd />
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {tasks.isError ? (
              <TasksErrorBanner onRetry={() => void tasks.refetch()} />
            ) : view === "list" ? (
              <TaskSections tasks={tasks.data ?? []} scope={scope} search={search} lists={lists.data ?? []} />
            ) : (
              <KanbanBoard tasks={tasks.data ?? []} />
            )}
          </div>
        </main>
      )}
      <FocusTimer />
    </div>
  )
}
