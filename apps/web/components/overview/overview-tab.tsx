"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { ApprovalHistory } from "@/components/approval/approval-history"
import { QUOTE_POLL_MS, useQuoteEditor } from "@/components/quotes/autosave"
import { useQuote } from "@/components/quotes/use-quote"
import { useTRPC } from "@/trpc/react"

import { CostChangeLog } from "./cost-change-log"
import { CustomerCard } from "./customer-card"
import { MixCard } from "./mix-card"
import { PhaseTimelineCard } from "./phase-timeline-card"
import { ResourceRolesCard } from "./resource-roles-card"

/**
 * The Quote editor's index tab: who it is for (Account and primary
 * Contact), who does the work (the Resource Roles by Effort), what it is
 * made of (the item-type mix with the blended rates), when (the Phases and
 * Milestones across the Quote dates), then the approval history and the
 * cost changes. The header's figures are never repeated here. Everything
 * but the Account comes from `quote.editor`, so it follows edits at once;
 * the page prefetches every query it reads.
 */
export function OverviewTab({ quoteId }: { quoteId: string }) {
  const trpc = useTRPC()
  const quote = useQuote(quoteId)
  const editor = useQuoteEditor(quoteId)
  const overview = useSuspenseQuery({
    ...trpc.quote.overview.queryOptions({ id: quoteId }),
    refetchOnWindowFocus: true,
    refetchInterval: QUOTE_POLL_MS,
  }).data

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <CustomerCard
          account={overview.account}
          contact={overview.primaryContact}
        />
        <ResourceRolesCard
          quoteId={quoteId}
          lines={editor.lines}
          roles={overview.resourceRoles}
          currency={editor.totals.currencyCode}
        />
        <MixCard
          lines={editor.lines}
          totals={editor.totals}
          className="lg:col-span-2 xl:col-span-1"
        />
      </div>
      <PhaseTimelineCard
        quoteId={quoteId}
        quote={quote}
        phases={editor.phases}
        lines={editor.lines}
        milestones={editor.milestones}
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ApprovalHistory quoteId={quoteId} />
        <CostChangeLog quoteId={quoteId} />
      </div>
    </div>
  )
}
