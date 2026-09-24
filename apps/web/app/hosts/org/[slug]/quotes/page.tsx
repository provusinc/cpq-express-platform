import type { Metadata } from "next"

import { INITIAL_QUOTE_LIST_INPUT } from "@/components/quotes/list-input"
import type { QuoteListInput } from "@/components/quotes/list-input"
import { QuotesList } from "@/components/quotes/quotes-list"
import {
  insightDays,
  insightListFilters,
  parseInsightFocus,
} from "@/lib/key-insights"
import { HydrateClient, prefetch, prefetchNow, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Quotes · CPQ Express" }

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // `?insight=…` / `?status=…`: a Dashboard card's filter (shareable).
  const focus = parseInsightFocus(await searchParams)
  prefetch(trpc.quote.filterOptions.queryOptions())
  prefetch(trpc.user.preferences.queryOptions())
  // "This month" and "today" are UTC days on the server's clock, as in
  // `quote.insights`.
  const initialFilters: QuoteListInput = {
    ...INITIAL_QUOTE_LIST_INPUT,
    ...insightListFilters(focus, insightDays()),
  }
  // The list reads it with `useQuery`: settle it before rendering.
  await prefetchNow(trpc.quote.list.queryOptions(initialFilters))
  return (
    <HydrateClient>
      <QuotesList focus={focus} initialFilters={initialFilters} />
    </HydrateClient>
  )
}
