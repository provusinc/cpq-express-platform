import type { RouterInputs } from "@workspace/api"

export type CatalogItemListInput = RouterInputs["catalogItem"]["list"]

/**
 * A Catalog Type's list's first query. The page prefetches exactly this
 * input, so it must match what `CatalogItemsList` asks for first.
 */
export const initialCatalogItemListInput = (catalogTypeId: string) =>
  ({
    catalogTypeId,
    status: "all",
    page: 1,
    pageSize: 25,
  }) satisfies CatalogItemListInput
