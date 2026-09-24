import { LineItemsTab } from "@/components/line-items/line-items-tab"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

type Params = Promise<{ slug: string; quoteId: string }>

/**
 * The Quote editor's Line Items tab: the grid, the Add Items sheet
 * and the Summary. The layout has already checked the Quote exists.
 */
export default async function QuoteLineItemsPage({
  params,
}: {
  params: Params
}) {
  const { quoteId } = await params
  prefetch(trpc.quote.editor.queryOptions({ id: quoteId }))
  return (
    <HydrateClient>
      <LineItemsTab quoteId={quoteId} />
    </HydrateClient>
  )
}
