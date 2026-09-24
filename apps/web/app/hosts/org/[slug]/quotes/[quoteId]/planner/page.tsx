import { PlannerTab } from "@/components/planner/planner-tab"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

type Params = Promise<{ slug: string; quoteId: string }>

/**
 * The Quote editor's Resource Planner tab. The layout has already checked
 * the Quote exists (and prefetched `quote.byId`).
 */
export default async function QuotePlannerPage({ params }: { params: Params }) {
  const { quoteId } = await params
  prefetch(trpc.quote.editor.queryOptions({ id: quoteId }))
  prefetch(trpc.quote.overview.queryOptions({ id: quoteId }))
  prefetch(trpc.settings.quoting.queryOptions())
  return (
    <HydrateClient>
      <PlannerTab quoteId={quoteId} />
    </HydrateClient>
  )
}
