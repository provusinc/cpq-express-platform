import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { CATALOG_TYPE_COLOUR_COUNT } from "@workspace/domain/catalog"
import { BILLING_UNITS } from "@workspace/domain/enums"

import { timestamps } from "../columns"
import { organizationReference, organizationTable } from "../organization-table"

/** Money columns are numeric(19,4), read back as strings (ADR-0002). */
const money = () => numeric({ precision: 19, scale: 4 })

export const billingUnitEnum = pgEnum("billing_unit", BILLING_UNITS)

/**
 * An Organization-defined kind of Catalog Item (glossary: Catalog Type,
 * ADR-0005). Every Organization starts with Product and Add-on
 * (`createDefaultCatalogTypes`), which are ordinary rows: no code branches
 * on a particular type.
 *
 * - `singular` / `plural` are its names in UI copy (unique per Organization,
 *   ignoring case); they replace the old Product / Add-on Label Overrides.
 * - `billingUnits` are the Billing Units its items may use (non-empty; the
 *   API checks an item's unit against it with `checkCatalogItemBillingUnit`).
 * - `colourIndex` picks its chart colour: the categorical series after labour
 *   (0 → series 2, … 5 → series 7).
 * - `active = false`: its items are listed read-only and can't be added to
 *   Quotes; it has no nav entry or Add Items tab.
 * - `sequence` orders the nav, the Add Items tabs and the Mix breakdown.
 */
export const catalogTypes = organizationTable(
  "catalog_types",
  {
    singular: text().notNull(),
    plural: text().notNull(),
    billingUnits: billingUnitEnum().array().notNull(),
    colourIndex: integer().notNull(),
    active: boolean().notNull().default(true),
    sequence: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("catalog_types_organization_id_singular_key").on(
      t.organizationId,
      sql`lower(${t.singular})`
    ),
    index().on(t.organizationId, t.sequence),
    check(
      "catalog_types_names_not_blank",
      sql`btrim(${t.singular}) <> '' and btrim(${t.plural}) <> ''`
    ),
    check(
      "catalog_types_billing_units_not_empty",
      sql`cardinality(${t.billingUnits}) > 0`
    ),
    check(
      "catalog_types_colour_index_range",
      sql`${t.colourIndex} >= 0 and ${t.colourIndex} < ${sql.raw(String(CATALOG_TYPE_COLOUR_COUNT))}`
    ),
    check("catalog_types_sequence_non_negative", sql`${t.sequence} >= 0`),
  ]
)

export type CatalogType = typeof catalogTypes.$inferSelect
export type NewCatalogType = typeof catalogTypes.$inferInsert

/**
 * Something the Organization sells at a list price and cost (glossary:
 * Catalog Item), of exactly one Catalog Type (composite FK, RESTRICT). Its
 * Billing Unit must be one its type allows (checked by the API with the
 * domain's `checkCatalogItemBillingUnit`). Inactive items stay on existing
 * Quotes but can't be added.
 *
 * Once Line Items exist they reference Catalog Items with ON DELETE
 * RESTRICT, and deleting a used item is refused with an "in use" error.
 */
export const catalogItems = organizationTable(
  "catalog_items",
  {
    catalogTypeId: uuid().notNull(),
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
    organizationReference(t, t.catalogTypeId, catalogTypes).onDelete(
      "restrict"
    ),
    check("catalog_items_price_non_negative", sql`${t.price} >= 0`),
    check("catalog_items_cost_non_negative", sql`${t.cost} >= 0`),
    index().on(t.organizationId, t.catalogTypeId, t.active),
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
