import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Whether a catalog record can be added to Quotes, in the status-badge
 * shape (a dot and a word): green Active, a quiet outline for Inactive.
 */
export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <Badge
      className={cn(
        "gap-1.5 rounded-md pl-1.5",
        active
          ? "bg-success-soft text-success-ink"
          : "border-border bg-transparent text-muted-foreground"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-success" : "bg-neutral"
        )}
      />
      {active ? "Active" : "Inactive"}
    </Badge>
  )
}
