import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { CatalogItemsList } from "@/components/catalog/catalog-items-list"
import { CsvImportButton } from "@/components/catalog/csv-import-dialog"
import { initialCatalogItemListInput } from "@/components/catalog/list-input"
import { getCatalogTypes } from "@/components/shell/get-catalog-types"
import { organizationAccess } from "@/lib/organization-access"
import { HydrateClient, prefetch, prefetchNow, trpc } from "@/trpc/server"

type Params = Promise<{ slug: string; typeId: string }>

/** The Catalog Type, or undefined when it isn't this Organization's. */
async function findType(typeId: string) {
  return (await getCatalogTypes()).find((t) => t.id === typeId)
}

export async function generateMetadata({
  params,
}: {
  params: Params
}): Promise<Metadata> {
  const type = await findType((await params).typeId)
  return { title: `${type?.plural ?? "Catalog"} · CPQ Express` }
}

/**
 * One Catalog Type's items (glossary: Catalog Type). An inactive type's
 * items are shown read-only; an unknown type is not found.
 */
export default async function CatalogTypePage({ params }: { params: Params }) {
  const type = await findType((await params).typeId)
  if (!type) notFound()
  const access = await organizationAccess("catalog.manage")
  // The list reads it with `useQuery`: settle it before rendering.
  await prefetchNow(
    trpc.catalogItem.list.queryOptions(initialCatalogItemListInput(type.id))
  )
  prefetch(trpc.catalogItem.tags.queryOptions({ catalogTypeId: type.id }))
  return (
    <HydrateClient>
      <CatalogItemsList
        key={type.id}
        catalogType={type}
        canManage={access.allowed && type.active}
        currencyCode={access.currencyCode}
        toolbar={
          <CsvImportButton
            target={{ type: "catalogItems", catalogType: type }}
          />
        }
      />
    </HydrateClient>
  )
}
