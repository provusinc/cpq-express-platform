import { QUOTE_STATUS_LABELS } from "@workspace/domain/enums"
import type { QuoteStatus } from "@workspace/domain/enums"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

/** Status colour: grey while open, amber waiting, green won, red lost. */
const TONES: Record<QuoteStatus, string> = {
  draft: "bg-secondary text-secondary-foreground",
  pending_approval:
    "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
  approved:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200",
  rejected: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  pending_customer_approval:
    "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200",
  customer_approved:
    "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950",
  customer_rejected:
    "bg-destructive/10 text-destructive dark:bg-destructive/20",
}

/** A Quote Status as a coloured badge, labelled as in the glossary. */
export function QuoteStatusBadge({
  status,
  className,
}: {
  status: QuoteStatus
  className?: string
}) {
  return (
    <Badge className={cn(TONES[status], className)}>
      {QUOTE_STATUS_LABELS[status]}
    </Badge>
  )
}
