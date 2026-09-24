import { FinancialsTab } from "@/components/financials/financials-tab"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

type Params = Promise<{ slug: string; quoteId: string }>

/**
 * The Quote editor's Financials tab. The layout has already checked the
 * Quote exists.
 */
export default async function QuoteFinancialsPage({
  params,
}: {
  params: Params
}) {
  const { quoteId } = await params
  prefetch(trpc.quote.financials.queryOptions({ id: quoteId }))
  return (
    <HydrateClient>
      <FinancialsTab quoteId={quoteId} />
    </HydrateClient>
  )
}
