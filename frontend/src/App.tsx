import { AlertCircle } from "lucide-react"
import { Header } from "@/components/header"
import { KanbanBoard } from "@/components/kanban-board"
import { QuickAdd } from "@/components/quick-add"
import { Sidebar } from "@/components/sidebar"
import { TaskSections } from "@/components/task-sections"
import { useLists, useTasks } from "@/hooks/api"
import { useUi } from "@/stores/ui"
import { Button } from "@/components/ui/button"

export default function App() {
  const { view, scope, search } = useUi()
  const tasks = useTasks()
  const lists = useLists()

  return (
    <div className="flex h-dvh overflow-hidden text-foreground">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Header />
        <QuickAdd />
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {tasks.isError ? (
            <div className="flex flex-col items-center gap-3 pt-24 text-center text-muted-foreground">
              <AlertCircle className="size-8 text-red-400" />
              <p className="text-sm">Can't reach the API. Is the backend running on port 8000?</p>
              <Button variant="outline" size="sm" onClick={() => void tasks.refetch()}>
                Retry
              </Button>
            </div>
          ) : view === "list" ? (
            <TaskSections
              tasks={tasks.data ?? []}
              scope={scope}
              search={search}
              lists={lists.data ?? []}
            />
          ) : (
            <KanbanBoard tasks={tasks.data ?? []} />
          )}
        </div>
      </main>
    </div>
  )
}
