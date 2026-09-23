import type { Metadata } from "next"

import { CatalogItemsList } from "@/components/catalog/catalog-items-list"
import { CsvImportButton } from "@/components/catalog/csv-import-dialog"
import { initialCatalogItemListInput } from "@/components/catalog/list-input"
import { organizationAccess } from "@/lib/organization-access"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Add-ons · CPQ Express" }

export default async function AddOnsPage() {
  const access = await organizationAccess("catalog.manage")
  prefetch(
    trpc.catalogItem.list.queryOptions(initialCatalogItemListInput("add_on"))
  )
  prefetch(trpc.catalogItem.tags.queryOptions({ kind: "add_on" }))
  return (
    <HydrateClient>
      <CatalogItemsList
        kind="add_on"
        canManage={access.allowed}
        currencyCode={access.currencyCode}
        toolbar={
          <CsvImportButton
            target={{ type: "catalogItems", defaultKind: "add_on" }}
          />
        }
      />
    </HydrateClient>
  )
}
