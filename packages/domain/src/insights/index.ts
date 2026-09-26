/**
 * Key Insights: the cards at the top of the Dashboard that say what needs
 * attention (glossary: Key Insight). This module owns each card's
 * definition (which Stages it counts, the low-margin threshold) and its
 * severity; the API counts the Quotes and the web app colours the cards.
 * Thresholds are carried over as-is from the Salesforce edition.
 */
import type { QuoteStage } from "../enums"
import { Decimal } from "../money"

/** The Key Insight cards, in display order. */
export const INSIGHT_KEYS = [
  "pending_approval",
  "high_value_pipeline",
  "low_margin",
  "valid_until_soon",
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
  valid_until_soon: "Valid Until soon",
  this_month: "This month",
  rejected: "Rejected",
}

/** Pending approval counts Quotes in this Stage. */
export const PENDING_APPROVAL_STAGES = [
  "in_approval",
] as const satisfies readonly QuoteStage[]

/** High-value pipeline: work not yet approved (Draft + In Approval). */
export const PIPELINE_STAGES = [
  "draft",
  "in_approval",
] as const satisfies readonly QuoteStage[]

/**
 * Glossary: Decided. Past approval (Approved, With Customer, Won, Lost), so
 * the Quote's margin is no longer actionable. A Rejected Quote is back in
 * Draft and not Decided.
 */
export const DECIDED_STAGES = [
  "approved",
  "with_customer",
  "won",
  "lost",
] as const satisfies readonly QuoteStage[]

/**
 * Low margin counts Quotes whose margin can still change: every Stage that
 * isn't Decided (Draft, Rejected ones included, and In Approval).
 */
export const LOW_MARGIN_STAGES = [
  "draft",
  "in_approval",
] as const satisfies readonly QuoteStage[]

/**
 * Valid Until soon counts Quotes whose offer is still in play (no customer
 * outcome yet): Draft, In Approval, Approved and With Customer.
 */
export const VALID_UNTIL_STAGES = [
  "draft",
  "in_approval",
  "approved",
  "with_customer",
] as const satisfies readonly QuoteStage[]

/** Valid Until soon: Valid Until from today to this many days ahead. */
export const VALID_UNTIL_SOON_DAYS = 14

/** A Quote is low-margin below this Margin % (with a positive Total). */
export const LOW_MARGIN_THRESHOLD = "15"

/**
 * Whether a Quote counts as low-margin: Margin % below the threshold, a
 * Total above zero (an empty Quote has no meaningful margin) and a Stage
 * that isn't Decided.
 */
export function isLowMargin(quote: {
  stage: QuoteStage
  total: Decimal.Value
  marginPct: Decimal.Value
}): boolean {
  return (
    (LOW_MARGIN_STAGES as readonly QuoteStage[]).includes(quote.stage) &&
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
 * - Valid Until soon: warning whenever there is one.
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
    case "valid_until_soon":
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
export function ageInDays(
  since: string | number,
  now: string | number
): number {
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

/** The UTC calendar day (`yyyy-MM-dd`) containing `now`: "today". */
export function utcDay(now: string | number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/**
 * The Valid Until window of the Valid Until soon card: `from` today to `to`,
 * `VALID_UNTIL_SOON_DAYS` later, both inclusive (`yyyy-MM-dd`, UTC days).
 */
export function validUntilWindow(today: string): { from: string; to: string } {
  const to = new Date(`${today}T00:00:00.000Z`)
  to.setUTCDate(to.getUTCDate() + VALID_UNTIL_SOON_DAYS)
  return { from: today, to: to.toISOString().slice(0, 10) }
}

/**
 * Whether a Quote counts as Valid Until soon on `today`: an offer still in
 * play (`VALID_UNTIL_STAGES`) whose Valid Until falls in `validUntilWindow`.
 * Valid Until is informational: this never changes the Stage.
 */
export function isValidUntilSoon(
  quote: { stage: QuoteStage; validUntil: string | null },
  today: string
): boolean {
  if (!quote.validUntil) return false
  if (!(VALID_UNTIL_STAGES as readonly QuoteStage[]).includes(quote.stage)) {
    return false
  }
  const { from, to } = validUntilWindow(today)
  return quote.validUntil >= from && quote.validUntil <= to
}

/** Whole days from `today` until `date` (negative once it has passed). */
export function daysUntil(date: string, today: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00.000Z`) -
      Date.parse(`${today}T00:00:00.000Z`)) /
      DAY_MS
  )
}
