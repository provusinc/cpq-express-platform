import type { Metadata } from "next"

import { QuotingSettings } from "@/components/settings/quoting-settings"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Quoting · Settings · CPQ Express" }

export default function QuotingSettingsPage() {
  prefetch(trpc.settings.quoting.queryOptions())
  return (
    <HydrateClient>
      <QuotingSettings />
    </HydrateClient>
  )
}
