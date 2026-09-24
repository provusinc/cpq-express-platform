import type { Metadata } from "next"

import { DocumentSettings } from "@/components/settings/document-settings"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = {
  title: "Documents · Settings · CPQ Express",
}

export default function DocumentSettingsPage() {
  prefetch(trpc.settings.documents.queryOptions())
  return (
    <HydrateClient>
      <DocumentSettings />
    </HydrateClient>
  )
}
