import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { CatalogItemsList } from "@/components/catalog/catalog-items-list"
import { CsvImportButton } from "@/components/catalog/csv-import-dialog"
import { initialCatalogItemListInput } from "@/components/catalog/list-input"
import { getLabels } from "@/components/shell/get-labels"
import { organizationAccess } from "@/lib/organization-access"
import { HydrateClient, prefetch, prefetchNow, trpc } from "@/trpc/server"

export async function generateMetadata(): Promise<Metadata> {
  const { add_on } = await getLabels()
  return { title: `${add_on.plural} · CPQ Express` }
}

export default async function AddOnsPage() {
  // Hidden in Settings → Labels: the Organization doesn't sell them.
  if (!(await getLabels()).add_on.enabled) notFound()
  const access = await organizationAccess("catalog.manage")
  // The list reads it with `useQuery`: settle it before rendering.
  await prefetchNow(
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
