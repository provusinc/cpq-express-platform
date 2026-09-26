import type { Metadata } from "next"

import { CatalogTypeSettings } from "@/components/settings/catalog-type-settings"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = {
  title: "Catalog types · Settings · CPQ Express",
}

export default function CatalogTypeSettingsPage() {
  prefetch(trpc.catalogType.list.queryOptions())
  return (
    <HydrateClient>
      <CatalogTypeSettings />
    </HydrateClient>
  )
}
