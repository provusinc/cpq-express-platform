import { notFound, redirect } from "next/navigation"

import { getCatalogTypes } from "@/components/shell/get-catalog-types"
import { catalogTypeHref, legacyCatalogType } from "@/lib/catalog-routes"

/** The old Products page: now a Catalog Type's page (#30). */
export default async function LegacyCatalogPage() {
  const type = legacyCatalogType(await getCatalogTypes(), "product")
  if (!type) notFound()
  redirect(catalogTypeHref(type.id))
}
