/**
 * The Dashboard: the Organization's landing page (glossary: Dashboard).
 * Besides the Key Insights (`../insights`) it shows the open pipeline
 * value and charts Quotes created per month. This module owns those
 * rules; the API aggregates in SQL and the web app draws them.
 */
import type { QuoteStatus } from "../enums"
import { Decimal } from "../money"

/**
 * Open: the Quote hasn't had a customer outcome yet (Draft, Pending
 * Approval, Approved, Rejected, Pending Customer Approval). The Dashboard
 * header sums their Totals.
 */
export const OPEN_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "pending_customer_approval",
] as const satisfies readonly QuoteStatus[]

/** How many months the activity chart covers (this month included). */
export const DASHBOARD_MONTHS = 12

/** How many rows each Dashboard list shows. */
export const DASHBOARD_LIST_LIMIT = 5

/**
 * The first days (`yyyy-MM-01`) of the `count` UTC months ending with the
 * one containing `now`, oldest first.
 */
export function recentUtcMonths(now: string | number, count: number): string[] {
  const at = new Date(now)
  const year = at.getUTCFullYear()
  const month = at.getUTCMonth()
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - (count - 1 - i), 1))
    return d.toISOString().slice(0, 10)
  })
}

/** One month of Quote activity. */
export interface MonthActivity {
  /** The month's first day, `yyyy-MM-01`. */
  month: string
  /** Quotes created that month. */
  count: number
  /** The sum of their Totals (4 dp). */
  value: string
}

/**
 * `months` with the activity found in `rows` (by `month`), zeros where a
 * month had none; rows outside `months` are dropped.
 */
export function fillMonths(
  months: readonly string[],
  rows: readonly { month: string; count: number; value: Decimal.Value }[]
): MonthActivity[] {
  const byMonth = new Map(rows.map((r) => [r.month, r]))
  return months.map((month) => {
    const row = byMonth.get(month)
    return {
      month,
      count: row?.count ?? 0,
      value: new Decimal(row?.value ?? 0).toFixed(4),
    }
  })
}
