/**
 * Reading a Customer's Customer Type and Industry (glossary: Customer Type /
 * Industry). Customers store the values' ids; every read resolves the names
 * here, so a rename in Settings shows everywhere.
 */
import { inArray, schema } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"

const { customerClassifications } = schema

/** A Customer's Customer Type or Industry as reads return it. */
export interface ClassificationRef {
  id: string
  name: string
  retired: boolean
}

/**
 * The Customer Type / Industry values with these ids, by id (a rename shows
 * everywhere because every read resolves the name here).
 */
export async function classificationRefs(
  scope: OrganizationScope,
  ids: (string | null | undefined)[]
): Promise<Map<string, ClassificationRef>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (wanted.length === 0) return new Map()
  const rows = await scope.findMany(customerClassifications, {
    where: inArray(customerClassifications.id, wanted),
  })
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, name: r.name, retired: r.retiredAt !== null },
    ])
  )
}
