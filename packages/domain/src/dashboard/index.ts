/**
 * The Dashboard: the Organization's landing page (glossary: Dashboard).
 * Besides the Key Insights (`../insights`) it shows the open pipeline
 * value and charts the Quote value created and Won over a
 * time range. This module owns those rules; the API aggregates in SQL
 * and the web app draws them.
 */
import type { QuoteStage } from "../enums"

/**
 * Open pipeline: every Quote not yet Won or Lost (Draft, In Approval,
 * Approved, With Customer). The Dashboard header sums their Totals.
 */
export const OPEN_STAGES = [
  "draft",
  "in_approval",
  "approved",
  "with_customer",
] as const satisfies readonly QuoteStage[]

/** How many rows each Dashboard list shows. */
export const DASHBOARD_LIST_LIMIT = 5

/**
 * The Quote value chart's time ranges (glossary: Dashboard), each a run
 * of UTC buckets ending with the one containing now: weeks (Monday
 * starts, as Postgres `date_trunc('week')`) for the long ranges, where
 * days would be mostly empty, and days for the short ones.
 */
export const VALUE_RANGES = ["12m", "90d", "30d", "7d"] as const
export type ValueRange = (typeof VALUE_RANGES)[number]

/** The range the Dashboard opens on. */
export const DEFAULT_VALUE_RANGE: ValueRange = "90d"

export type BucketUnit = "day" | "week"

/** Each range's bucket unit, bucket count and label ("Last 3 months"). */
export const VALUE_RANGE_SPECS: Record<
  ValueRange,
  { unit: BucketUnit; count: number; label: string }
> = {
  // 53 weeks, so the current partial week doesn't cut the year short.
  "12m": { unit: "week", count: 53, label: "Last 12 months" },
  "90d": { unit: "week", count: 13, label: "Last 3 months" },
  "30d": { unit: "day", count: 30, label: "Last 30 days" },
  "7d": { unit: "day", count: 7, label: "Last 7 days" },
}

const DAY_MS = 86_400_000

/**
 * The buckets of `range` at `now`: their `unit`, the first bucket's start
 * (`from`, inclusive, `yyyy-MM-dd` UTC), the last one's (`last`, the
 * bucket containing `now`) and every start, oldest first.
 */
export function valueBuckets(
  now: string | number,
  range: ValueRange
): { unit: BucketUnit; from: string; last: string; starts: string[] } {
  const { unit, count } = VALUE_RANGE_SPECS[range]
  const at = new Date(now)
  const today = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
  const step = unit === "week" ? 7 * DAY_MS : DAY_MS
  // Monday of this week: getUTCDay() is 0 on Sunday.
  const lastStart =
    unit === "week" ? today - ((at.getUTCDay() + 6) % 7) * DAY_MS : today
  const starts = Array.from({ length: count }, (_, i) =>
    new Date(lastStart - (count - 1 - i) * step).toISOString().slice(0, 10)
  )
  return { unit, from: starts[0]!, last: starts.at(-1)!, starts }
}
