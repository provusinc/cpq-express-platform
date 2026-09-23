import type { Metadata } from "next"

import { INITIAL_QUOTE_LIST_INPUT } from "@/components/quotes/list-input"
import { QuotesList } from "@/components/quotes/quotes-list"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Quotes · CPQ Express" }

export default function QuotesPage() {
  prefetch(trpc.quote.list.queryOptions(INITIAL_QUOTE_LIST_INPUT))
  prefetch(trpc.quote.filterOptions.queryOptions())
  prefetch(trpc.user.preferences.queryOptions())
  return (
    <HydrateClient>
      <QuotesList />
    </HydrateClient>
  )
}
