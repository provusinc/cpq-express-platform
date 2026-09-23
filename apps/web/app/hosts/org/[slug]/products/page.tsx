import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { CatalogItemsList } from "@/components/catalog/catalog-items-list"
import { CsvImportButton } from "@/components/catalog/csv-import-dialog"
import { initialCatalogItemListInput } from "@/components/catalog/list-input"
import { getLabels } from "@/components/shell/get-labels"
import { organizationAccess } from "@/lib/organization-access"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export async function generateMetadata(): Promise<Metadata> {
  const { product } = await getLabels()
  return { title: `${product.plural} · CPQ Express` }
}

export default async function ProductsPage() {
  // Hidden in Settings → Labels: the Organization doesn't sell them.
  if (!(await getLabels()).product.enabled) notFound()
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
