/**
 * An Organization's Customer Types and Industries (glossary: Customer Type /
 * Industry), starting with `DEFAULT_CUSTOMER_CLASSIFICATIONS`.
 *
 *   await createDefaultCustomerClassifications(organizationScope(tx, organization.id))
 *
 * Every path that creates an Organization (the Platform Admin console, the
 * seed, the API test fixtures) calls it. It lives in `db` (not `api`) so the
 * seed uses it too.
 */
import { and, eq, sql } from "drizzle-orm"

import { CUSTOMER_CLASSIFICATION_KINDS } from "@workspace/domain/enums"
import type { CustomerClassificationKind } from "@workspace/domain/enums"
import { DEFAULT_CUSTOMER_CLASSIFICATIONS } from "@workspace/domain/customers"

import type { OrganizationScope } from "./organization-scope"
import { customerClassifications } from "./schema"

/**
 * Gives each of the scope's Organization's lists its defaults, but only a
 * list that has no values yet (so a list the Admin emptied or shaped is
 * never topped up by a re-run).
 */
export async function createDefaultCustomerClassifications(
  scope: OrganizationScope
) {
  for (const kind of CUSTOMER_CLASSIFICATION_KINDS) {
    const [existing] = await scope.findMany(customerClassifications, {
      where: eq(customerClassifications.kind, kind),
      limit: 1,
    })
    if (existing) continue
    await scope.insertMany(
      customerClassifications,
      DEFAULT_CUSTOMER_CLASSIFICATIONS[kind].map((name, sequence) => ({
        kind,
        name,
        sequence,
      }))
    )
  }
}

/**
 * The id of the value named `name` (ignoring case) in the list, created at
 * the end of the list when missing. For the seed and fixtures.
 */
export async function ensureCustomerClassification(
  scope: OrganizationScope,
  kind: CustomerClassificationKind,
  name: string
): Promise<string> {
  const [found] = await scope.findMany(customerClassifications, {
    where: and(
      eq(customerClassifications.kind, kind),
      sql`lower(${customerClassifications.name}) = lower(${name.trim()})`
    ),
    limit: 1,
  })
  if (found) return found.id
  const [last] = await scope.db
    .select({
      max: sql<number>`coalesce(max(${customerClassifications.sequence}), -1)::int`,
    })
    .from(customerClassifications)
    .where(
      scope.where(
        customerClassifications,
        eq(customerClassifications.kind, kind)
      )
    )
  const row = await scope.insert(customerClassifications, {
    kind,
    name: name.trim(),
    sequence: (last?.max ?? -1) + 1,
  })
  return row.id
}
