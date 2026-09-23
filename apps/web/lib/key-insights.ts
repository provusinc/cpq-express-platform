/**
 * Which Quote list filter a Key Insight card applies. The choice lives in
 * the URL (`/quotes?insight=low_margin` or `/quotes?status=draft`), so a
 * filtered list can be shared; the page resolves it into the list's input.
 */
import { QUOTE_STATUSES } from "@workspace/domain/enums"
import type { QuoteStatus } from "@workspace/domain/enums"
import {
  INSIGHT_KEYS,
  LOW_MARGIN_STATUSES,
  LOW_MARGIN_THRESHOLD,
  PENDING_APPROVAL_STATUSES,
  PIPELINE_STATUSES,
  REJECTED_STATUSES,
} from "@workspace/domain/insights"
import type { InsightKey } from "@workspace/domain/insights"

/** A card the list is focused on: an insight or a status count. */
export type InsightFocus =
  | { kind: "insight"; key: InsightKey }
  | { kind: "status"; status: QuoteStatus }

/** The list filters a focus applies (on top of the list's defaults). */
export interface InsightListFilters {
  statuses?: QuoteStatus[]
  marginBelow?: string
  createdFrom?: string
  sort?: { by: "total" | "createdAt"; direction: "asc" | "desc" }
}

type SearchParams = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/** Reads `?insight=` or `?status=`; anything unknown is no focus. */
export function parseInsightFocus(params: SearchParams): InsightFocus | null {
  const insight = first(params.insight)
  if (insight && (INSIGHT_KEYS as readonly string[]).includes(insight)) {
    return { kind: "insight", key: insight as InsightKey }
  }
  const status = first(params.status)
  if (status && (QUOTE_STATUSES as readonly string[]).includes(status)) {
    return { kind: "status", status: status as QuoteStatus }
  }
  return null
}

/** The query string that selects a focus (`""` for none). */
export function insightFocusQuery(focus: InsightFocus | null): string {
  if (!focus) return ""
  return focus.kind === "insight"
    ? `?insight=${focus.key}`
    : `?status=${focus.status}`
}

/** A stable identity for a focus, to tell when it changes. */
export const insightFocusKey = (focus: InsightFocus | null) =>
  insightFocusQuery(focus) || "none"

/**
 * The list filters for a focus. `thisMonthFrom` is the first day of the
 * current UTC month (from `quote.insights`, or computed by the page).
 * - pending approval → Pending Approval;
 * - high-value pipeline → Draft + Pending Approval, largest Total first;
 * - low margin → the undecided statuses with Margin % below 15 (the API
 *   also requires a positive Total);
 * - this month → created on or after the month's first day;
 * - rejected → Rejected + Customer Rejected;
 * - a status count → that status.
 */
export function insightListFilters(
  focus: InsightFocus | null,
  thisMonthFrom: string
): InsightListFilters {
  if (!focus) return {}
  if (focus.kind === "status") return { statuses: [focus.status] }
  switch (focus.key) {
    case "pending_approval":
      return { statuses: [...PENDING_APPROVAL_STATUSES] }
    case "high_value_pipeline":
      return {
        statuses: [...PIPELINE_STATUSES],
        sort: { by: "total", direction: "desc" },
      }
    case "low_margin":
      return {
        statuses: [...LOW_MARGIN_STATUSES],
        marginBelow: LOW_MARGIN_THRESHOLD,
      }
    case "this_month":
      return { createdFrom: thisMonthFrom }
    case "rejected":
      return { statuses: [...REJECTED_STATUSES] }
  }
}
