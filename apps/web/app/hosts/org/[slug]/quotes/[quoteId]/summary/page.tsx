import { permanentRedirect } from "next/navigation"

type Params = Promise<{ slug: string; quoteId: string }>

/** The Summary tab folded into the Overview (the index route). */
export default async function QuoteSummaryRedirect({
  params,
}: {
  params: Params
}) {
  const { quoteId } = await params
  permanentRedirect(`/quotes/${quoteId}`)
}
