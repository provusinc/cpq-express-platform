import type { CSSProperties } from "react"

import type { QuoteStage } from "@workspace/domain/enums"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Stage tones, the same everywhere a Quote Status shows (list, editor
 * header, approval history, Dashboard, ⌘K): a Status takes the tone of its
 * Quote Stage — neutral in Draft, amber waiting on an Approver, soft green
 * approved, iris out with the customer, red lost. Won is the one solid
 * badge: it is final. A Status with its own colour uses that instead.
 */
const TONES: Record<QuoteStage, string> = {
  draft: "bg-neutral-soft text-neutral-ink",
  in_approval: "bg-warning-soft text-warning-ink",
  approved: "bg-success-soft text-success-ink",
  with_customer: "bg-iris-soft text-iris-ink",
  won: "bg-success text-white dark:text-[oklch(0.2_0.04_160)] [&>[data-dot]]:bg-current",
  lost: "bg-danger-soft text-danger-ink",
}

/** The solid colour of each Stage (dots, bars). */
export const STAGE_SOLID: Record<QuoteStage, string> = {
  draft: "bg-neutral",
  in_approval: "bg-warning",
  approved: "bg-success/60",
  with_customer: "bg-iris",
  won: "bg-success",
  lost: "bg-danger",
}

/** A Status's own colour as a soft fill with readable text. */
const ownColour = (colour: string): CSSProperties => ({
  backgroundColor: `color-mix(in oklab, ${colour} 16%, transparent)`,
  color: `color-mix(in oklab, ${colour} 65%, var(--foreground))`,
})

/**
 * A Quote's Status as a coloured badge: the Organization's Status name in
 * the tone of its Stage (or the Status's own colour). `rejected` adds the
 * small "Rejected" marker beside it (a Draft whose latest Approval Step is a
 * rejection; glossary: Rejected).
 */
export function QuoteStatusBadge({
  stage,
  status,
  rejected = false,
  className,
}: {
  stage: QuoteStage
  status: { name: string; colour?: string | null }
  rejected?: boolean
  className?: string
}) {
  const colour = status.colour ?? null
  const badge = (
    <Badge
      className={cn(
        "gap-1.5 rounded-md pl-1.5",
        colour ? null : TONES[stage],
        rejected ? null : className
      )}
      style={colour ? ownColour(colour) : undefined}
    >
      <span
        data-dot
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          colour ? null : STAGE_SOLID[stage]
        )}
        style={colour ? { backgroundColor: colour } : undefined}
      />
      {status.name}
    </Badge>
  )
  if (!rejected) return badge
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {badge}
      <RejectedMarker />
    </span>
  )
}

/** The small "Rejected" marker shown beside a Rejected Quote's Status. */
export function RejectedMarker({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-md border-danger/40 px-1.5 text-danger-ink",
        className
      )}
    >
      Rejected
    </Badge>
  )
}
