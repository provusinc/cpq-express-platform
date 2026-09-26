import "server-only"

import { cache } from "react"

import type { CatalogTypeView } from "./catalog-types"

import { getCaller } from "@/trpc/server"

/**
 * The request's Catalog Types for server components (`catalogType.list`,
 * once per request). Empty when the caller may not read them (e.g. in
 * `generateMetadata` for a signed-out visitor): the Organization layout
 * decides access, not this.
 */
export const getCatalogTypes = cache(async (): Promise<CatalogTypeView[]> => {
  try {
    return await (await getCaller()).catalogType.list()
  } catch {
    return []
  }
})
