import { Skeleton } from "@/components/ui/skeleton"

/** Mimics the grouped list view: section title + task rows. */
export function TaskListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-6 px-6 pt-1" aria-busy="true" aria-label="Loading tasks">
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2">
            <Skeleton className="size-4 rounded-[4px]" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5" style={{ width: `${58 + ((i * 17) % 34)}%` }} />
              <Skeleton className="h-2.5 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Mimics three board columns with stacked cards. */
export function KanbanSkeleton() {
  return (
    <div className="flex h-full gap-4 px-6 pt-1 pb-6" aria-busy="true" aria-label="Loading board">
      {Array.from({ length: 3 }, (_, c) => (
        <div key={c} className="flex w-72 shrink-0 flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <div className="flex-1 space-y-2 rounded-2xl bg-muted/40 p-2">
            {Array.from({ length: 3 - (c % 2) }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Mimics the insights stat row + chart cards. */
export function InsightsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading insights">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="glass space-y-2.5 rounded-2xl p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        ))}
      </div>
      <div className="glass rounded-2xl p-4">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="mt-3 h-36 rounded-lg" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="glass rounded-2xl p-4">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="mt-3 h-28 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  )
}
