import { SummaryTab } from "@/components/summary/summary-tab"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

type Params = Promise<{ slug: string; quoteId: string }>

/**
 * The Quote editor's Summary tab. The layout has already checked the
 * Quote exists.
 */
export default async function QuoteSummaryPage({ params }: { params: Params }) {
  const { quoteId } = await params
  prefetch(trpc.quote.summary.queryOptions({ id: quoteId }))
  prefetch(trpc.quote.approvalHistory.queryOptions({ id: quoteId }))
  prefetch(trpc.quote.costChangeLog.queryOptions({ id: quoteId }))
  return (
    <HydrateClient>
      <SummaryTab quoteId={quoteId} />
    </HydrateClient>
  )
}
