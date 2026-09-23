import type { Metadata } from "next"

import { AwaitingApprovalList } from "@/components/approval/awaiting-approval-list"
import { AWAITING_PAGE_SIZE } from "@/components/approval/list-input"
import { PageHeader } from "@/components/shell/page-header"
import { getCaller, HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = {
  title: "Awaiting my approval · CPQ Express",
}

/** "Awaiting my approval" — Approvers only (the API checks again). */
export default async function ApprovalsPage() {
  // The layout has already checked the Membership.
  const { membership } = await (await getCaller()).organization.current()
  if (!membership.isApprover) {
    return (
      <PageHeader
        title="Awaiting my approval"
        description="Only Approvers approve or reject Quotes. An Admin can grant you the Approver right."
      />
    )
  }
  prefetch(
    trpc.quote.awaitingMyApproval.queryOptions({
      page: 1,
      pageSize: AWAITING_PAGE_SIZE,
    })
  )
  return (
    <HydrateClient>
      <AwaitingApprovalList />
    </HydrateClient>
  )
}
