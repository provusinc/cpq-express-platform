import type { Metadata } from "next"

import { CustomerFieldSettings } from "@/components/settings/customer-field-settings"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = {
  title: "Customer fields · Settings · CPQ Express",
}

export default function CustomerFieldSettingsPage() {
  prefetch(trpc.settings.customerClassifications.queryOptions())
  return (
    <HydrateClient>
      <CustomerFieldSettings />
    </HydrateClient>
  )
}
