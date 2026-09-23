import type { Metadata } from "next"

import { CatalogItemsList } from "@/components/catalog/catalog-items-list"
import { CsvImportButton } from "@/components/catalog/csv-import-dialog"
import { initialCatalogItemListInput } from "@/components/catalog/list-input"
import { organizationAccess } from "@/lib/organization-access"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Products · CPQ Express" }

export default async function ProductsPage() {
  const access = await organizationAccess("catalog.manage")
  prefetch(
    trpc.catalogItem.list.queryOptions(initialCatalogItemListInput("product"))
  )
  prefetch(trpc.catalogItem.tags.queryOptions({ kind: "product" }))
  return (
    <HydrateClient>
      <CatalogItemsList
        kind="product"
        canManage={access.allowed}
        currencyCode={access.currencyCode}
        toolbar={
          <CsvImportButton
            target={{ type: "catalogItems", defaultKind: "product" }}
          />
        }
      />
    </HydrateClient>
  )
}
