import { notFound, redirect } from "next/navigation"

import { getCatalogTypes } from "@/components/shell/get-catalog-types"
import { catalogTypeHref, firstCatalogType } from "@/lib/catalog-routes"

/** `/catalog`: the first active Catalog Type's page. */
export default async function CatalogPage() {
  const type = firstCatalogType(await getCatalogTypes())
  if (!type) notFound()
  redirect(catalogTypeHref(type.id))
}
