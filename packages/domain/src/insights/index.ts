/**
 * Key Insights: the cards above the Quote list that say what needs
 * attention (glossary: Key Insight). This module owns each card's
 * definition (which statuses it counts, the low-margin threshold) and its
 * severity; the API counts the Quotes and the web app colours the cards.
 * Thresholds are carried over as-is from the Salesforce edition.
 */
import type { QuoteStatus } from "../enums"
import { Decimal } from "../money"

/** The Key Insight cards, in display order. */
export const INSIGHT_KEYS = [
  "pending_approval",
  "high_value_pipeline",
  "low_margin",
  "this_month",
  "rejected",
] as const
export type InsightKey = (typeof INSIGHT_KEYS)[number]

/** How a card is coloured: info (neutral), warning or critical. */
export const INSIGHT_SEVERITIES = ["info", "warning", "critical"] as const
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number]

/** Card titles for UI copy. */
export const INSIGHT_LABELS: Record<InsightKey, string> = {
  pending_approval: "Pending approval",
  high_value_pipeline: "High-value pipeline",
  low_margin: "Low margin",
  this_month: "This month",
  rejected: "Rejected",
}

/** Pending approval counts Quotes in this status. */
export const PENDING_APPROVAL_STATUSES = [
  "pending_approval",
] as const satisfies readonly QuoteStatus[]

/** High-value pipeline: work not yet approved (Draft + Pending Approval). */
export const PIPELINE_STATUSES = [
  "draft",
  "pending_approval",
] as const satisfies readonly QuoteStatus[]

/** Rejected: by an Approver or by the customer. */
export const REJECTED_STATUSES = [
  "rejected",
  "customer_rejected",
] as const satisfies readonly QuoteStatus[]

/**
 * Decided statuses: an Approver or the customer has ruled on the Quote
 * (Approved, Rejected, Customer Approved, Customer Rejected), so its margin
 * is no longer actionable. The Salesforce edition excludes the same set.
 */
export const DECIDED_STATUSES = [
  "approved",
  "rejected",
  "customer_approved",
  "customer_rejected",
] as const satisfies readonly QuoteStatus[]

/**
 * Low margin counts Quotes whose margin can still change or matters for a
 * pending decision: every status that isn't decided (Draft, Pending
 * Approval, Pending Customer Approval).
 */
export const LOW_MARGIN_STATUSES = [
  "draft",
  "pending_approval",
  "pending_customer_approval",
] as const satisfies readonly QuoteStatus[]

/** A Quote is low-margin below this Margin % (with a positive Total). */
export const LOW_MARGIN_THRESHOLD = "15"

/**
 * Whether a Quote counts as low-margin: Margin % below the threshold, a
 * Total above zero (an empty Quote has no meaningful margin) and a status
 * that isn't decided.
 */
export function isLowMargin(quote: {
  status: QuoteStatus
  total: Decimal.Value
  marginPct: Decimal.Value
}): boolean {
  return (
    (LOW_MARGIN_STATUSES as readonly QuoteStatus[]).includes(quote.status) &&
    new Decimal(quote.total).greaterThan(0) &&
    new Decimal(quote.marginPct).lessThan(LOW_MARGIN_THRESHOLD)
  )
}

/** What a card's severity depends on. */
export interface InsightFacts {
  /** How many Quotes the card counts. */
  count: number
  /** Pending approval only: whole days the longest-waiting Quote has waited. */
  oldestAgeDays?: number | null
}

/**
 * A card's severity.
 * - Pending approval: critical if ≥ 5 Quotes or the oldest has waited
 *   ≥ 7 days; warning if ≥ 2 Quotes or ≥ 3 days; else info.
 * - Low margin: warning whenever there is one.
 * - Rejected: warning if ≥ 3.
 * - High-value pipeline and this month's activity: always info.
 */
export function insightSeverity(
  key: InsightKey,
  { count, oldestAgeDays }: InsightFacts
): InsightSeverity {
  switch (key) {
    case "pending_approval": {
      if (count === 0) return "info"
      const age = oldestAgeDays ?? 0
      if (count >= 5 || age >= 7) return "critical"
      if (count >= 2 || age >= 3) return "warning"
      return "info"
    }
    case "low_margin":
      return count > 0 ? "warning" : "info"
    case "rejected":
      return count >= 3 ? "warning" : "info"
    case "high_value_pipeline":
    case "this_month":
      return "info"
  }
}

const DAY_MS = 86_400_000

/**
 * Whole days elapsed from `since` to `now` (floored; never negative).
 * Both are instants (`Date`-parsable ISO timestamps or epoch milliseconds).
 */
export function ageInDays(since: string | number, now: string | number): number {
  const ms = new Date(now).getTime() - new Date(since).getTime()
  return ms > 0 ? Math.floor(ms / DAY_MS) : 0
}

/**
 * The first day (`yyyy-MM-dd`) of the UTC month containing `now`: "this
 * month" for the activity card. Organizations have no timezone yet, so
 * months are UTC months.
 */
export function startOfUtcMonth(now: string | number): string {
  return new Date(now).toISOString().slice(0, 7) + "-01"
}
