import { OverviewTab } from "@/components/overview/overview-tab"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

type Params = Promise<{ slug: string; quoteId: string }>

/**
 * The Quote editor's index tab, Overview: the Account and primary Contact,
 * the Resource Roles, the mix, the Phase timeline, the approval history and
 * the cost changes. The layout has already checked the Quote exists.
 */
export default async function QuoteOverviewPage({
  params,
}: {
  params: Params
}) {
  const { quoteId } = await params
  prefetch(trpc.quote.overview.queryOptions({ id: quoteId }))
  prefetch(trpc.quote.editor.queryOptions({ id: quoteId }))
  prefetch(trpc.quote.approvalHistory.queryOptions({ id: quoteId }))
  prefetch(trpc.quote.costChangeLog.queryOptions({ id: quoteId }))
  return (
    <HydrateClient>
      <OverviewTab quoteId={quoteId} />
    </HydrateClient>
  )
}
