import { sql } from "drizzle-orm"
import {
  check,
  index,
  numeric,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { organizationReference, organizationTable } from "../organization-table"
import { users } from "./auth"
import { lineItems, sourceKindEnum } from "./line-items"
import { quotes } from "./quotes"

/** Money is numeric(19,4) (ADR-0002). */
const money = () => numeric({ precision: 19, scale: 4 })

/**
 * The cost change log: one row per Line Item whose Base Rate cost Cost
 * Propagation rewrote (glossary: Cost Propagation), so users can see why a
 * Draft Quote's margins moved. Written in the same transaction as the
 * Catalog Item / Resource Role cost update.
 *
 * - `quoteId` / `lineItemId` cascade: the log goes with its Quote or line.
 * - The source is recorded by kind, id and its name at the time
 *   (`sourceId` is not a foreign key, so the log never blocks anything).
 * - `oldCost` / `newCost` are the line's Base Rate cost before and after.
 * - `actorId` is the Admin who changed the cost.
 */
export const costChangeLog = organizationTable(
  "cost_change_log",
  {
    quoteId: uuid().notNull(),
    lineItemId: uuid().notNull(),
    sourceKind: sourceKindEnum().notNull(),
    sourceId: uuid().notNull(),
    sourceName: text().notNull(),
    oldCost: money().notNull(),
    newCost: money().notNull(),
    actorId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    organizationReference(t, t.quoteId, quotes).onDelete("cascade"),
    organizationReference(t, t.lineItemId, lineItems).onDelete("cascade"),
    check(
      "cost_change_log_costs_non_negative",
      sql`${t.oldCost} >= 0 and ${t.newCost} >= 0`
    ),
    index().on(t.organizationId, t.quoteId, t.createdAt),
  ]
)

export type CostChangeLogEntry = typeof costChangeLog.$inferSelect
export type NewCostChangeLogEntry = typeof costChangeLog.$inferInsert
