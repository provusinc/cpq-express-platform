import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { timestamps } from "../columns"
import { organizationTable } from "../organization-table"
import { quoteStageEnum } from "./enums"

/**
 * An Organization's own name for where a Quote stands (glossary: Quote
 * Status, ADR-0004), belonging to exactly one fixed Quote Stage. Statuses
 * carry no behaviour: the Stage does. Every Organization starts with one per
 * Stage (`DEFAULT_QUOTE_STATUSES`, created by `createDefaultQuoteStatuses`).
 *
 * - `name` is unique within the Organization (ignoring case).
 * - `sequence` orders the Statuses within their Stage; entering a Stage
 *   lands a Quote on its first one (`stageEntryStatus`).
 * - `colour` is an optional lowercase `#rrggbb`; without one the badge takes
 *   its Stage's tone.
 * - The `(organization_id, id, stage)` key lets `quotes` reference a Status
 *   together with its Stage, so a Quote's Stage always matches its Status's.
 */
export const quoteStatuses = organizationTable(
  "quote_statuses",
  {
    stage: quoteStageEnum().notNull(),
    name: text().notNull(),
    sequence: integer().notNull(),
    colour: text(),
    ...timestamps(),
  },
  (t) => [
    unique("quote_statuses_organization_id_id_stage_key").on(
      t.organizationId,
      t.id,
      t.stage
    ),
    uniqueIndex("quote_statuses_organization_id_name_key").on(
      t.organizationId,
      sql`lower(${t.name})`
    ),
    index().on(t.organizationId, t.stage, t.sequence),
    check("quote_statuses_name_not_blank", sql`btrim(${t.name}) <> ''`),
    check("quote_statuses_sequence_non_negative", sql`${t.sequence} >= 0`),
    check(
      "quote_statuses_colour_hex",
      sql`${t.colour} is null or ${t.colour} ~ '^#[0-9a-f]{6}$'`
    ),
  ]
)

export type QuoteStatusRow = typeof quoteStatuses.$inferSelect
