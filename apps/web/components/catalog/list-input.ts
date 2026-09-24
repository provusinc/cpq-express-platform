import type { RouterInputs } from "@workspace/api"
import type { CatalogItemKind } from "@workspace/domain/enums"

export type CatalogItemListInput = RouterInputs["catalogItem"]["list"]

/**
 * The Products / Add-ons list's first query. The page prefetches exactly
 * this input, so it must match what `CatalogItemsList` asks for first.
 */
export const initialCatalogItemListInput = (kind: CatalogItemKind) =>
  ({
    kind,
    status: "all",
    page: 1,
    pageSize: 25,
  }) satisfies CatalogItemListInput
