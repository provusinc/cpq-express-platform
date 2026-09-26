/**
 * Which Quote list filter a Key Insight card (or a Dashboard card) applies. The choice lives in
 * the URL (`/quotes?insight=low_margin` or `/quotes?status=in_approval`, a
 * Quote Stage), so a filtered list can be shared; the page resolves it into
 * the list's input.
 */
import { QUOTE_STAGES } from "@workspace/domain/enums"
import type { QuoteStage } from "@workspace/domain/enums"
import {
  VALID_UNTIL_STAGES,
  validUntilWindow,
  INSIGHT_KEYS,
  LOW_MARGIN_STAGES,
  LOW_MARGIN_THRESHOLD,
  PENDING_APPROVAL_STAGES,
  PIPELINE_STAGES,
  startOfUtcMonth,
  utcDay,
} from "@workspace/domain/insights"
import type { InsightKey } from "@workspace/domain/insights"

/** A card the list is focused on: an insight or a Stage. */
export type InsightFocus =
  | { kind: "insight"; key: InsightKey }
  | { kind: "stage"; stage: QuoteStage }

/** The list filters a focus applies (on top of the list's defaults). */
export interface InsightListFilters {
  stages?: QuoteStage[]
  rejected?: boolean
  marginBelow?: string
  createdFrom?: string
  validUntilFrom?: string
  validUntilTo?: string
  sort?: {
    by: "total" | "createdAt" | "validUntil"
    direction: "asc" | "desc"
  }
}

/** `InsightDays` for the instant `now` (the server's clock by default). */
export function insightDays(now: number = Date.now()): InsightDays {
  return { thisMonthFrom: startOfUtcMonth(now), today: utcDay(now) }
}

/** The days the focus filters are relative to (UTC, server clock). */
export interface InsightDays {
  /** The first day of the current UTC month. */
  thisMonthFrom: string
  /** The current UTC day. */
  today: string
}

type SearchParams = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/**
 * Reads `?insight=` or `?status=` (a Quote Stage, e.g. `in_approval`);
 * anything unknown is no focus.
 */
export function parseInsightFocus(params: SearchParams): InsightFocus | null {
  const insight = first(params.insight)
  if (insight && (INSIGHT_KEYS as readonly string[]).includes(insight)) {
    return { kind: "insight", key: insight as InsightKey }
  }
  const stage = first(params.status)
  if (stage && (QUOTE_STAGES as readonly string[]).includes(stage)) {
    return { kind: "stage", stage: stage as QuoteStage }
  }
  return null
}

/** The query string that selects a focus (`""` for none). */
export function insightFocusQuery(focus: InsightFocus | null): string {
  if (!focus) return ""
  return focus.kind === "insight"
    ? `?insight=${focus.key}`
    : `?status=${focus.stage}`
}

/** A stable identity for a focus, to tell when it changes. */
export const insightFocusKey = (focus: InsightFocus | null) =>
  insightFocusQuery(focus) || "none"

/**
 * The list filters for a focus. `days` are the current UTC month's first
 * day and today (from `quote.insights`, or computed by the page).
 * - pending approval → In Approval;
 * - high-value pipeline → Draft + In Approval, largest Total first;
 * - low margin → the Stages that aren't Decided with Margin % below 15
 *   (the API also requires a positive Total);
 * - Valid Until soon → the offers in play with Valid Until from today to 14
 *   days ahead, soonest first;
 * - this month → created on or after the month's first day;
 * - rejected → Rejected Quotes (the derived fact, not a Stage);
 * - a Stage → that Stage.
 */
export function insightListFilters(
  focus: InsightFocus | null,
  { thisMonthFrom, today }: InsightDays
): InsightListFilters {
  if (!focus) return {}
  if (focus.kind === "stage") return { stages: [focus.stage] }
  switch (focus.key) {
    case "pending_approval":
      return { stages: [...PENDING_APPROVAL_STAGES] }
    case "high_value_pipeline":
      return {
        stages: [...PIPELINE_STAGES],
        sort: { by: "total", direction: "desc" },
      }
    case "low_margin":
      return {
        stages: [...LOW_MARGIN_STAGES],
        marginBelow: LOW_MARGIN_THRESHOLD,
      }
    case "valid_until_soon": {
      const { from, to } = validUntilWindow(today)
      return {
        stages: [...VALID_UNTIL_STAGES],
        validUntilFrom: from,
        validUntilTo: to,
        sort: { by: "validUntil", direction: "asc" },
      }
    }
    case "this_month":
      return { createdFrom: thisMonthFrom }
    case "rejected":
      return { rejected: true }
  }
}
