import { sql } from "drizzle-orm"
import {
  check,
  date,
  index,
  numeric,
  pgEnum,
  text,
  uuid,
} from "drizzle-orm/pg-core"

import { DISCOUNT_KINDS, TIME_PERIODS } from "@workspace/domain/enums"

import { timestamps } from "../columns"
import { organizationReference, organizationTable } from "../organization-table"
import { accounts } from "./accounts"
import { users } from "./auth"
import { quoteStatusEnum } from "./enums"

/** Money is numeric(19,4) and percentages numeric(7,4), read back as strings (ADR-0002). */
const money = () => numeric({ precision: 19, scale: 4 })
const percent = () => numeric({ precision: 7, scale: 4 })
/** A calendar date, read and written as an ISO `yyyy-MM-dd` string (`IsoDate`). */
const isoDate = () => date({ mode: "string" })

/** Glossary: Time Period, from `@workspace/domain`. */
export const timePeriodEnum = pgEnum("time_period", TIME_PERIODS)
/** How the Quote Discount was entered: a percentage or a fixed amount. */
export const discountKindEnum = pgEnum("discount_kind", DISCOUNT_KINDS)

/**
 * A priced engagement offered to one Account (glossary: Quote).
 *
 * - `ownerId` is the Quote Owner: the User who created it, fixed for life
 *   (never transferred). It references the global `users` table, so a
 *   removed member stays the owner; the policy then treats their Role as
 *   `null`. `createdById` / `updatedById` record who created and last
 *   changed the Quote (every command sets `updatedById`).
 * - The Account is required and RESTRICTs its deletion (archive instead).
 * - Name is required and not unique (nothing is auto-numbered); creating a
 *   second Quote with the same Name for an Account only warns.
 * - `currencyCode` is the Organization's currency, snapshotted at creation.
 * - The Quote Discount is `discountKind` + `discountValue` (a percent, 10 =
 *   10 %, or an amount), both null for none; whichever was entered stays
 *   authoritative. Subtotal, discount amount, Total, cost, Margin and
 *   margin % are computed by the domain pricing engine after every command
 *   and persisted here (they are zero until Line Items exist).
 */
export const quotes = organizationTable(
  "quotes",
  {
    ownerId: uuid()
      .notNull()
      .references(() => users.id),
    createdById: uuid()
      .notNull()
      .references(() => users.id),
    updatedById: uuid()
      .notNull()
      .references(() => users.id),
    accountId: uuid().notNull(),
    name: text().notNull(),
    description: text(),
    /** Glossary: Quote Start Date / Quote End Date (user-owned). */
    startDate: isoDate().notNull(),
    endDate: isoDate().notNull(),
    /** Glossary: Valid Until. Informational; never changes the status. */
    validUntil: isoDate(),
    timePeriod: timePeriodEnum().notNull().default("months"),
    status: quoteStatusEnum().notNull().default("draft"),
    currencyCode: text().notNull(),
    discountKind: discountKindEnum(),
    discountValue: money(),
    subtotal: money().notNull().default("0"),
    discountAmount: money().notNull().default("0"),
    total: money().notNull().default("0"),
    cost: money().notNull().default("0"),
    margin: money().notNull().default("0"),
    marginPct: percent().notNull().default("0"),
    ...timestamps(),
  },
  (t) => [
    organizationReference(t, t.accountId, accounts).onDelete("restrict"),
    check("quotes_dates_ordered", sql`${t.endDate} >= ${t.startDate}`),
    check("quotes_currency_code_format", sql`${t.currencyCode} ~ '^[A-Z]{3}$'`),
    check(
      "quotes_discount_complete",
      sql`(${t.discountKind} is null) = (${t.discountValue} is null)`
    ),
    check(
      "quotes_discount_value_non_negative",
      sql`${t.discountValue} is null or ${t.discountValue} >= 0`
    ),
    // List filters and sorts (every list query is per Organization).
    index().on(t.organizationId, t.createdAt),
    index().on(t.organizationId, t.updatedAt),
    index().on(t.organizationId, t.status),
    index().on(t.organizationId, t.ownerId),
    // The Account's Quotes: delete checks and the duplicate-Name warning.
    index("quotes_organization_id_account_id_name_index").on(
      t.organizationId,
      t.accountId,
      sql`lower(btrim(${t.name}))`
    ),
  ]
)

export type Quote = typeof quotes.$inferSelect
export type NewQuote = typeof quotes.$inferInsert
