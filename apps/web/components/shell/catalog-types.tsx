"use client"

import { createContext, useContext, useMemo } from "react"

import type { RouterOutputs } from "@workspace/api"

/** A Catalog Type as the client reads it (`catalogType.list`). */
export type CatalogTypeView = RouterOutputs["catalogType"]["list"][number]

const CatalogTypesContext = createContext<readonly CatalogTypeView[]>([])

/**
 * Provides the Organization's Catalog Types (glossary: Catalog Type, in
 * order, inactive included) to client components. The Organization layout
 * loads them on the server (`catalogType.list`) and passes them in through
 * the app shell; after changing types, `router.refresh()`.
 */
export function CatalogTypesProvider({
  catalogTypes,
  children,
}: {
  catalogTypes: readonly CatalogTypeView[]
  children: React.ReactNode
}) {
  return (
    <CatalogTypesContext value={catalogTypes}>{children}</CatalogTypesContext>
  )
}

/** Every Catalog Type of the Organization, in order (inactive included). */
export function useCatalogTypes(): readonly CatalogTypeView[] {
  return useContext(CatalogTypesContext)
}

/** The active Catalog Types, in order: nav entries and Add Items tabs. */
export function useActiveCatalogTypes(): readonly CatalogTypeView[] {
  const types = useCatalogTypes()
  return useMemo(() => types.filter((t) => t.active), [types])
}

/** One Catalog Type by id (undefined when unknown). */
export function useCatalogType(
  id: string | null | undefined
): CatalogTypeView | undefined {
  const types = useCatalogTypes()
  return id ? types.find((t) => t.id === id) : undefined
}
