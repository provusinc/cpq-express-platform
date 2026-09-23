import { sql } from "drizzle-orm"
import { char, check, pgTable, text } from "drizzle-orm/pg-core"

import { id, timestamps } from "../columns"

/**
 * Subdomains that are never an Organization (ADR-0001). Mirrored by the
 * host resolution in `apps/web/lib/hosts.ts`; both move to
 * `@workspace/domain` once it owns the slug rules.
 */
export const RESERVED_SLUGS = [
  "app",
  "admin",
  "www",
  "api",
  "auth",
  "docs",
  "status",
] as const

/** A DNS label: lowercase letters, digits and inner hyphens, 1–63 chars. */
export const SLUG_PATTERN = "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$"

/**
 * The unit of tenancy (glossary: Organization), reached at
 * `{slug}.<ROOT_DOMAIN>`. Not itself a business table: business tables
 * reference it through `organizationTable` (see `../organization-table.ts`).
 *
 * `slug` is immutable — a trigger (migration 0003) rejects any change.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    /** ISO 4217 code; one currency per Organization, set at provisioning. */
    currencyCode: char({ length: 3 }).notNull(),
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
