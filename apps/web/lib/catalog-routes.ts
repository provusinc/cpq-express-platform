import { DEFAULT_CATALOG_TYPES } from "@workspace/domain/catalog"

/** The public path of a Catalog Type's page. */
export const catalogTypeHref = (id: string) => `/catalog/${id}`

interface TypeFacts {
  id: string
  singular: string
  plural: string
  active: boolean
  sequence: number
}

const byOrder = <T extends TypeFacts>(types: readonly T[]) =>
  [...types].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))

/**
 * Where an old `/products` or `/add-ons` link lands (they became Catalog
 * Types, #30): the type still named like the default (ignoring case), else
 * the type at that default's position (the migration created them in
 * `DEFAULT_CATALOG_TYPES` order), else the first type. `undefined` when the
 * Organization has none.
 */
export function legacyCatalogType<T extends TypeFacts>(
  types: readonly T[],
  legacy: "product" | "add_on"
): T | undefined {
  const index = legacy === "product" ? 0 : 1
  const fallback = DEFAULT_CATALOG_TYPES[index]!
  const ordered = byOrder(types)
  const named = (name: string) => name.trim().toLowerCase()
  return (
    ordered.find(
      (t) =>
        named(t.singular) === named(fallback.singular) ||
        named(t.plural) === named(fallback.plural)
    ) ??
    ordered[index] ??
    ordered[0]
  )
}

/** `/catalog`: the first active Catalog Type (else the first at all). */
export function firstCatalogType<T extends TypeFacts>(
  types: readonly T[]
): T | undefined {
  const ordered = byOrder(types)
  return ordered.find((t) => t.active) ?? ordered[0]
}
