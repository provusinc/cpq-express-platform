/**
 * An Organization's Catalog Types (glossary: Catalog Type, ADR-0005),
 * starting with `DEFAULT_CATALOG_TYPES` (Product, Add-on).
 *
 *   await createDefaultCatalogTypes(organizationScope(tx, organization.id))
 *
 * Every path that creates an Organization (the Platform Admin console, the
 * seed, the API test fixtures) calls it. It lives in `db` (not `api`) so the
 * seed uses it too.
 */
import { asc, sql } from "drizzle-orm"

import { DEFAULT_CATALOG_TYPES } from "@workspace/domain/catalog"
import type { DefaultCatalogType } from "@workspace/domain/catalog"

import type { OrganizationScope } from "./organization-scope"
import { catalogTypes } from "./schema"
import type { CatalogType } from "./schema"

/**
 * Gives the scope's Organization the default Catalog Types, but only when it
 * has none yet (so types the Admin deleted or reshaped are never topped up
 * by a re-run). Returns the Organization's types in order.
 */
export async function createDefaultCatalogTypes(
  scope: OrganizationScope
): Promise<CatalogType[]> {
  const existing = await scope.findMany(catalogTypes, {
    orderBy: [asc(catalogTypes.sequence), asc(catalogTypes.id)],
  })
  if (existing.length > 0) return existing
  return scope.insertMany(
    catalogTypes,
    DEFAULT_CATALOG_TYPES.map((type, sequence) => ({
      singular: type.singular,
      plural: type.plural,
      billingUnits: [...type.billingUnits],
      colourIndex: type.colourIndex,
      sequence,
    }))
  )
}

/**
 * The Catalog Type named `type.singular` (ignoring case), created at the end
 * when missing. For the seed and fixtures.
 */
export async function ensureCatalogType(
  scope: OrganizationScope,
  type: DefaultCatalogType
): Promise<CatalogType> {
  const [found] = await scope.findMany(catalogTypes, {
    where: sql`lower(${catalogTypes.singular}) = lower(${type.singular})`,
    limit: 1,
  })
  if (found) return found
  const [last] = await scope.db
    .select({
      max: sql<number>`coalesce(max(${catalogTypes.sequence}), -1)::int`,
    })
    .from(catalogTypes)
    .where(scope.where(catalogTypes))
  return scope.insert(catalogTypes, {
    singular: type.singular,
    plural: type.plural,
    billingUnits: [...type.billingUnits],
    colourIndex: type.colourIndex,
    sequence: (last?.max ?? -1) + 1,
  })
}
