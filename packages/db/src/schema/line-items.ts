import { sql } from "drizzle-orm"
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import { PERIOD_TYPES, SOURCE_KINDS } from "@workspace/domain/enums"

import { timestamps } from "../columns"
import { organizationReference, organizationTable } from "../organization-table"
import { billingUnitEnum, catalogItems, resourceRoles } from "./catalog"
import { quotes } from "./quotes"

/** Money is numeric(19,4), percentages numeric(7,4), quantities numeric(18,3) (ADR-0002). */
const money = () => numeric({ precision: 19, scale: 4 })
const percent = () => numeric({ precision: 7, scale: 4 })
const quantity = () => numeric({ precision: 18, scale: 3 })
/** A calendar date, read and written as an ISO `yyyy-MM-dd` string (`IsoDate`). */
const isoDate = () => date({ mode: "string" })

/** What a Line Item was added from (glossary: Catalog Item, Resource Role). */
export const sourceKindEnum = pgEnum("source_kind", SOURCE_KINDS)
/** The bucket an Allocation covers (week, month, quarter). */
export const periodTypeEnum = pgEnum("period_type", PERIOD_TYPES)

/**
 * A named, ordered grouping of Line Items within a Quote (glossary: Phase).
 * `parentId` nests it (depth ≤ 3, checked by the API with the domain's
 * `canPlacePhase`); a top-level Phase has none. Totals and dates are always
 * derived from the contents, never stored.
 *
 * The parent must be a Phase of the same Quote: the self-reference is
 * `(organization_id, quote_id, parent_id) → phases(organization_id,
 * quote_id, id)`, and deleting a Phase cascades to its descendants (and,
 * through `line_items.phase_id`, to their Line Items).
 *
 * Created here so Line Items can reference it; the Phases ticket (#14) adds
 * the commands and the tree UI.
 */
export const phases = organizationTable(
  "phases",
  {
    quoteId: uuid().notNull(),
    parentId: uuid(),
    name: text().notNull(),
    /** Order among its siblings (ascending, ties by id). */
    sequence: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    organizationReference(t, t.quoteId, quotes).onDelete("cascade"),
    unique("phases_organization_id_quote_id_id_key").on(
      t.organizationId,
      t.quoteId,
      t.id
    ),
    foreignKey({
      name: "phases_parent_id_fk",
      columns: [t.organizationId, t.quoteId, t.parentId],
      foreignColumns: [t.organizationId, t.quoteId, t.id],
    }).onDelete("cascade"),
    check("phases_not_own_parent", sql`${t.parentId} is distinct from ${t.id}`),
    index().on(t.organizationId, t.quoteId, t.sequence),
  ]
)

export type Phase = typeof phases.$inferSelect
export type NewPhase = typeof phases.$inferInsert

/**
 * A single priced row on a Quote (glossary: Line Item), sourced from a
 * Catalog Item (`sourceKind` catalog_item → `catalogItemId`; its Catalog
 * Type is reached through the item) or a
 * Resource Role (`resource_role` → `resourceRoleId`); a check constraint
 * requires exactly the matching reference. Sources can't be deleted while a
 * Line Item references them (ON DELETE RESTRICT; the API answers with an
 * "in use" error suggesting deactivation).
 *
 * - `basePrice` / `baseCost` are the Base Rate, copied from the source when
 *   the line is added. Catalog price edits never change them; cost edits
 *   reach them only on Draft Quotes (Cost Propagation, #24).
 * - `unitPrice` starts at `basePrice` and may be overridden (a negotiated
 *   rate); `unitCost` follows `baseCost`.
 * - `lineTotal` (unit price × quantity, rounded to the currency's minor
 *   unit) and `lineMarginPct` (the line's own margin, before the Quote
 *   Discount) are computed by the domain pricing engine after every command
 *   (`recomputeQuoteTotals`) and never accepted from a client.
 * - `phaseId` is optional (a line may sit outside every Phase). The Phase
 *   must belong to the same Quote: `(organization_id, quote_id, phase_id) →
 *   phases(organization_id, quote_id, id)`, cascading when the Phase goes.
 * - `sequence` orders lines within their Phase (or among Phase-less lines).
 */
export const lineItems = organizationTable(
  "line_items",
  {
    quoteId: uuid().notNull(),
    phaseId: uuid(),
    sourceKind: sourceKindEnum().notNull(),
    catalogItemId: uuid(),
    resourceRoleId: uuid(),
    name: text().notNull(),
    description: text(),
    notes: text(),
    startDate: isoDate().notNull(),
    endDate: isoDate().notNull(),
    billingUnit: billingUnitEnum().notNull(),
    basePrice: money().notNull(),
    baseCost: money().notNull(),
    unitPrice: money().notNull(),
    unitCost: money().notNull(),
    quantity: quantity().notNull(),
    lineTotal: money().notNull().default("0"),
    lineMarginPct: percent().notNull().default("0"),
    sequence: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    organizationReference(t, t.quoteId, quotes).onDelete("cascade"),
    organizationReference(t, t.catalogItemId, catalogItems).onDelete(
      "restrict"
    ),
    organizationReference(t, t.resourceRoleId, resourceRoles).onDelete(
      "restrict"
    ),
    foreignKey({
      name: "line_items_phase_id_fk",
      columns: [t.organizationId, t.quoteId, t.phaseId],
      foreignColumns: [phases.organizationId, phases.quoteId, phases.id],
    }).onDelete("cascade"),
    check(
      "line_items_source_matches_kind",
      sql`(${t.sourceKind} = 'resource_role' and ${t.resourceRoleId} is not null and ${t.catalogItemId} is null)
        or (${t.sourceKind} <> 'resource_role' and ${t.catalogItemId} is not null and ${t.resourceRoleId} is null)`
    ),
    check(
      "line_items_billing_unit_matches_kind",
      sql`${t.sourceKind} <> 'resource_role' or ${t.billingUnit} = 'hour'`
    ),
    check("line_items_dates_ordered", sql`${t.endDate} >= ${t.startDate}`),
    check("line_items_quantity_non_negative", sql`${t.quantity} >= 0`),
    check(
      "line_items_rates_non_negative",
      sql`${t.basePrice} >= 0 and ${t.baseCost} >= 0 and ${t.unitPrice} >= 0 and ${t.unitCost} >= 0`
    ),
    index().on(t.organizationId, t.quoteId, t.sequence),
    // "In use" checks and Cost Propagation look lines up by source.
    index().on(t.organizationId, t.catalogItemId),
    index().on(t.organizationId, t.resourceRoleId),
  ]
)

export type LineItem = typeof lineItems.$inferSelect
export type NewLineItem = typeof lineItems.$inferInsert

/**
 * The Effort of a Resource Role Line Item in one bucket of the Quote's Time
 * Period (glossary: Allocation): `periodStart` is the bucket's first day
 * (Monday, the 1st, or a quarter's first day), `amount` is hours (or units).
 * Unique per (Line Item, period type, period start). A line that has
 * Allocations is planner-managed: its quantity always equals Σ amounts.
 *
 * Created with the Line Items so deletes, undo and quantity edits already
 * respect them; the Resource Planner (#15) writes them (and enforces
 * "Resource Role lines only" and the per-cell caps via the domain).
 */
export const allocations = organizationTable(
  "allocations",
  {
    lineItemId: uuid().notNull(),
    periodType: periodTypeEnum().notNull(),
    periodStart: isoDate().notNull(),
    amount: quantity().notNull(),
    ...timestamps(),
  },
  (t) => [
    organizationReference(t, t.lineItemId, lineItems).onDelete("cascade"),
    unique("allocations_line_item_period_key").on(
      t.organizationId,
      t.lineItemId,
      t.periodType,
      t.periodStart
    ),
    check("allocations_amount_positive", sql`${t.amount} > 0`),
  ]
)

export type AllocationRow = typeof allocations.$inferSelect
export type NewAllocationRow = typeof allocations.$inferInsert
