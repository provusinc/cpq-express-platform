import { TimelineTab } from "@/components/timeline/timeline-tab"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

type Params = Promise<{ slug: string; quoteId: string }>

/**
 * The Quote editor's Timeline tab: the Gantt of Line Items by Phase with
 * Milestones, and the Milestone list. The layout has already checked the
 * Quote exists.
 */
export default async function QuoteTimelinePage({
  params,
}: {
  params: Params
}) {
  const { quoteId } = await params
  prefetch(trpc.quote.editor.queryOptions({ id: quoteId }))
  prefetch(trpc.settings.quoting.queryOptions())
  return (
    <HydrateClient>
      <TimelineTab quoteId={quoteId} />
    </HydrateClient>
  )
}
