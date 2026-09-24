import { sql } from "drizzle-orm"
import { char, check, pgTable, text } from "drizzle-orm/pg-core"

import { RESERVED_SLUGS, SLUG_PATTERN } from "@workspace/domain/organizations"

import { id, timestamps } from "../columns"

/**
 * The unit of tenancy (glossary: Organization), reached at
 * `{slug}.<ROOT_DOMAIN>`. Not itself a business table: business tables
 * reference it through `organizationTable` (see `../organization-table.ts`).
 *
 * `slug` is immutable — a trigger (migration 0003) rejects any change. The
 * slug check constraints are built from `@workspace/domain/organizations`,
 * the same rules the API and host resolution use.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    /** ISO 4217 code; one currency per Organization, set at provisioning. */
    currencyCode: char({ length: 3 }).notNull(),
    // Company information (Settings → Company), printed on Quote Documents.
    // The company name is `name`. All optional.
    email: text(),
    phone: text(),
    website: text(),
    addressLine1: text(),
    addressLine2: text(),
    city: text(),
    region: text(),
    postalCode: text(),
    country: text(),
    /** Object-storage key of the logo (`@workspace/storage`); only the key is kept here. */
    logoKey: text(),
    ...timestamps(),
  },
  (t) => [
    check(
      "organizations_slug_format",
      sql`${t.slug} ~ ${sql.raw(`'${SLUG_PATTERN}'`)}`
    ),
    check(
      "organizations_slug_not_reserved",
      sql`${t.slug} not in (${sql.raw(RESERVED_SLUGS.map((s) => `'${s}'`).join(", "))})`
    ),
    check(
      "organizations_currency_code_format",
      sql`${t.currencyCode} ~ '^[A-Z]{3}$'`
    ),
  ]
)

export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
