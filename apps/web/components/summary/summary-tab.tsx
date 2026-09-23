"use client"

import { ApprovalHistory } from "@/components/approval/approval-history"

/**
 * The Quote editor's Summary tab: the approval history (#19). The page
 * prefetches every query it reads.
 */
export function SummaryTab({ quoteId }: { quoteId: string }) {
  return (
    <div className="grid gap-4">
      <ApprovalHistory quoteId={quoteId} />
    </div>
  )
}
