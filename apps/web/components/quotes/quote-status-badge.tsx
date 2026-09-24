import { QUOTE_STATUS_LABELS } from "@workspace/domain/enums"
import type { QuoteStatus } from "@workspace/domain/enums"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Status tones, the same everywhere a Quote Status shows (list, editor
 * header, approval history, Key Insights): neutral while open, amber
 * waiting on an Approver, iris out with the customer, green approved, red
 * rejected. Customer Approved is the one solid badge: it is final.
 */
const TONES: Record<QuoteStatus, string> = {
  draft: "bg-neutral-soft text-neutral-ink",
  pending_approval: "bg-warning-soft text-warning-ink",
  approved: "bg-success-soft text-success-ink",
  rejected: "bg-danger-soft text-danger-ink",
  pending_customer_approval: "bg-iris-soft text-iris-ink",
  customer_approved:
    "bg-success text-white dark:text-[oklch(0.2_0.04_160)] [&>[data-dot]]:bg-current",
  customer_rejected: "bg-danger-soft text-danger-ink",
}

/** The solid colour of each status (dots, the status distribution bar). */
export const STATUS_SOLID: Record<QuoteStatus, string> = {
  draft: "bg-neutral",
  pending_approval: "bg-warning",
  approved: "bg-success/60",
  rejected: "bg-danger/70",
  pending_customer_approval: "bg-iris",
  customer_approved: "bg-success",
  customer_rejected: "bg-danger",
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
    <Badge
      className={cn("gap-1.5 rounded-md pl-1.5", TONES[status], className)}
    >
      <span
        data-dot
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", STATUS_SOLID[status])}
      />
      {QUOTE_STATUS_LABELS[status]}
    </Badge>
  )
}
