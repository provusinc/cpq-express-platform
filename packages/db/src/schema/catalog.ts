import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  numeric,
  pgEnum,
  text,
} from "drizzle-orm/pg-core"

import { BILLING_UNITS, CATALOG_ITEM_KINDS } from "@workspace/domain/enums"

import { timestamps } from "../columns"
import { organizationTable } from "../organization-table"

/** Money columns are numeric(19,4), read back as strings (ADR-0002). */
const money = () => numeric({ precision: 19, scale: 4 })

export const catalogItemKindEnum = pgEnum(
  "catalog_item_kind",
  CATALOG_ITEM_KINDS
)
export const billingUnitEnum = pgEnum("billing_unit", BILLING_UNITS)

/**
 * Something the Organization sells at a list price and cost (glossary:
 * Catalog Item): a Product, always billed Each, or an Add-on, billed Each or
 * Hour. Inactive items stay on existing Quotes but can't be added.
 *
 * Once Line Items exist they reference Catalog Items with ON DELETE
 * RESTRICT, and deleting a used item is refused with an "in use" error.
 */
export const catalogItems = organizationTable(
  "catalog_items",
  {
    kind: catalogItemKindEnum().notNull(),
    name: text().notNull(),
    description: text(),
    price: money().notNull(),
    cost: money().notNull(),
    billingUnit: billingUnitEnum().notNull().default("each"),
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    check(
      "catalog_items_product_billed_each",
      sql`${t.kind} <> 'product' OR ${t.billingUnit} = 'each'`
    ),
    check("catalog_items_price_non_negative", sql`${t.price} >= 0`),
    check("catalog_items_cost_non_negative", sql`${t.cost} >= 0`),
    index().on(t.organizationId, t.kind, t.active),
    index("catalog_items_tags_index").using("gin", t.tags),
  ]
)

export type CatalogItem = typeof catalogItems.$inferSelect
export type NewCatalogItem = typeof catalogItems.$inferInsert

/**
 * A kind of labour sold by the hour (glossary: Resource Role), with a bill
 * rate, a cost rate and a location. Always hourly, so it has no billing
 * unit column.
 */
export const resourceRoles = organizationTable(
  "resource_roles",
  {
    name: text().notNull(),
    description: text(),
    billRate: money().notNull(),
    costRate: money().notNull(),
    locationCountry: text(),
    locationState: text(),
    locationCity: text(),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    check("resource_roles_bill_rate_non_negative", sql`${t.billRate} >= 0`),
    check("resource_roles_cost_rate_non_negative", sql`${t.costRate} >= 0`),
    index().on(t.organizationId, t.active),
  ]
)

export type ResourceRole = typeof resourceRoles.$inferSelect
export type NewResourceRole = typeof resourceRoles.$inferInsert
