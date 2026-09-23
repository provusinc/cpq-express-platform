import type { Metadata } from "next"

import { KeyInsights } from "@/components/quotes/key-insights"
import { INITIAL_QUOTE_LIST_INPUT } from "@/components/quotes/list-input"
import type { QuoteListInput } from "@/components/quotes/list-input"
import { QuotesList } from "@/components/quotes/quotes-list"
import { insightListFilters, parseInsightFocus } from "@/lib/key-insights"
import {
  getQueryClient,
  HydrateClient,
  prefetch,
  prefetchNow,
  trpc,
} from "@/trpc/server"

export const metadata: Metadata = { title: "Quotes · CPQ Express" }

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // `?insight=…` / `?status=…`: a Key Insight card's filter (shareable).
  const focus = parseInsightFocus(await searchParams)
  prefetch(trpc.quote.filterOptions.queryOptions())
  prefetch(trpc.user.preferences.queryOptions())
  // The insights say which month "this month" is (UTC, server clock).
  const { thisMonthFrom } = await getQueryClient().fetchQuery(
    trpc.quote.insights.queryOptions()
  )
  const initialFilters: QuoteListInput = {
    ...INITIAL_QUOTE_LIST_INPUT,
    ...insightListFilters(focus, thisMonthFrom),
  }
  // The list reads it with `useQuery`: settle it before rendering.
  await prefetchNow(trpc.quote.list.queryOptions(initialFilters))
  return (
    <HydrateClient>
      <QuotesList
        insights={<KeyInsights focus={focus} />}
        focus={focus}
        initialFilters={initialFilters}
      />
    </HydrateClient>
  )
}
