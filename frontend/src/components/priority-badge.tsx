import { Flag } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { Priority } from "@/api/types"
import { cn } from "cn"

const PRIORITY_META: Record<Priority, { label: string; className: string } | null> = {
  3: { label: "High", className: "text-high" },
  2: { label: "Medium", className: "text-medium" },
  1: { label: "Low", className: "text-low" },
  0: null,
}

export function PriorityBadge({ priority, showIcon = true }: { priority: Priority; showIcon?: boolean }) {
  const meta = PRIORITY_META[priority]
  if (!meta) return null
  return (
    <Badge variant="outline" className={cn("gap-1", meta.className)}>
      {showIcon && <Flag className="size-3 fill-current/20" />}
      {meta.label}
    </Badge>
  )
}
