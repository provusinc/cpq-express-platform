import type { Metadata } from "next"

import { CompanySettings } from "@/components/settings/company-settings"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Company · Settings · CPQ Express" }

export default function CompanySettingsPage() {
  prefetch(trpc.settings.company.queryOptions())
  return (
    <HydrateClient>
      <CompanySettings />
    </HydrateClient>
  )
}
