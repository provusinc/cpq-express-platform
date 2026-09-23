import { DocumentsTab } from "@/components/documents/documents-tab"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

type Params = Promise<{ slug: string; quoteId: string }>

/**
 * The Quote editor's Documents tab. The layout has already checked the
 * Quote exists. The preview input is fetched in the browser (it renders
 * there); the list is prefetched.
 */
export default async function QuoteDocumentsPage({
  params,
}: {
  params: Params
}) {
  const { quoteId } = await params
  prefetch(trpc.quoteDocument.list.queryOptions({ quoteId }))
  return (
    <HydrateClient>
      <DocumentsTab quoteId={quoteId} />
    </HydrateClient>
  )
}
