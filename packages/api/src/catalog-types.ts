/**
 * Catalog Type reads shared by the catalog and Line Item commands (glossary:
 * Catalog Type, ADR-0005).
 */
import { asc, schema } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"

import { notFound } from "./errors"

const { catalogTypes } = schema

/** The Organization's Catalog Types, in order (active and inactive). */
export function listCatalogTypes(scope: OrganizationScope) {
  return scope.findMany(catalogTypes, {
    orderBy: [asc(catalogTypes.sequence), asc(catalogTypes.id)],
  })
}

/** One of the Organization's Catalog Types; NOT_FOUND otherwise. */
export async function loadCatalogType(scope: OrganizationScope, id: string) {
  const type = await scope.findById(catalogTypes, id)
  if (!type) throw notFound("Catalog Type")
  return type
}

/** A Catalog Type as the API returns it. */
export type CatalogTypeView = Awaited<ReturnType<typeof loadCatalogType>>
