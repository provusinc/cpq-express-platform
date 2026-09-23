import type { Metadata } from "next"

import { LabelSettings } from "@/components/settings/label-settings"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Labels · Settings · CPQ Express" }

export default function LabelSettingsPage() {
  prefetch(trpc.settings.labels.queryOptions())
  return (
    <HydrateClient>
      <LabelSettings />
    </HydrateClient>
  )
}
