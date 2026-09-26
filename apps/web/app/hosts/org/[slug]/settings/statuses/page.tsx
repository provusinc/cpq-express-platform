import type { Metadata } from "next"

import { QuoteStatusSettings } from "@/components/settings/quote-status-settings"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = {
  title: "Quote Statuses · Settings · CPQ Express",
}

export default function QuoteStatusSettingsPage() {
  prefetch(trpc.settings.quoteStatuses.queryOptions())
  return (
    <HydrateClient>
      <QuoteStatusSettings />
    </HydrateClient>
  )
}
