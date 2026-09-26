/**
 * `quote.insights`, registered on the `quote` router: the Key Insight cards
 * at the top of the Dashboard, the count per status and the caller's recent
 * Quotes. The definitions and severities are the domain's
 * (`@workspace/domain/insights`); this file only counts.
 */
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  or,
  schema,
  sql,
} from "@workspace/db"
import type { SQL } from "@workspace/db"
import { QUOTE_STATUSES } from "@workspace/domain/enums"
import type { QuoteStatus } from "@workspace/domain/enums"
import {
  ageInDays,
  VALID_UNTIL_STATUSES,
  validUntilWindow,
  INSIGHT_KEYS,
  insightSeverity,
  LOW_MARGIN_STATUSES,
  LOW_MARGIN_THRESHOLD,
  PENDING_APPROVAL_STATUSES,
  PIPELINE_STATUSES,
  REJECTED_STATUSES,
  startOfUtcMonth,
  utcDay,
} from "@workspace/domain/insights"
import type { InsightKey } from "@workspace/domain/insights"
import { toMoneyString } from "@workspace/domain/money"

import { organizationProcedure } from "../trpc"

const { customers, approvalSteps, quotes } = schema

/** How many recent Quotes the insights return. */
export const RECENT_QUOTES_LIMIT = 5

/**
 * Margin % below `threshold` with a positive Total: the low-margin rule,
 * shared by the card and the Quote list's `marginBelow` filter.
 */
export const marginBelow = (threshold: string) =>
  and(lt(quotes.marginPct, threshold), gt(quotes.total, "0"))!

/** The start of a UTC day, for `createdAt` comparisons. */
const utcDayStart = (date: string) => new Date(`${date}T00:00:00.000Z`)

export const quoteInsightsProcedures = {
  /**
   * The Key Insights for the whole Organization (every member sees every
   * Quote), computed now:
   * - `pending_approval`: Pending Approval Quotes, their value and the
   *   oldest wait, measured from each Quote's latest submit Approval Step;
   * - `high_value_pipeline`: Draft + Pending Approval, count and value;
   * - `low_margin`: Margin % < 15 with Total > 0, excluding decided
   *   statuses (Approved, Rejected, Customer Approved/Rejected);
   * - `valid_until_soon`: Valid Until from today to 14 days ahead, on an
   *   offer still in play (Draft, Pending Approval, Approved, Pending
   *   Customer Approval);
   * - `this_month`: Quotes created since the start of this UTC month;
   * - `rejected`: Rejected + Customer Rejected.
   * Each card carries its domain severity. Also the count per status (every
   * status, zeros included), `thisMonthFrom` (the month's first day) and
   * `today` (the UTC day), for the list filters, and the caller's recent Quotes: those they created or
   * last changed, most recently changed first.
   */
  insights: organizationProcedure.query(async ({ ctx }) => {
    const now = new Date()
    const thisMonthFrom = startOfUtcMonth(now.getTime())
    const today = utcDay(now.getTime())
    const validUntilSoon = validUntilWindow(today)

    // The latest submit step of each Quote: when it entered the queue.
    const submitted = ctx.scope.db
      .selectDistinctOn([approvalSteps.quoteId], {
        quoteId: approvalSteps.quoteId,
        submittedAt: approvalSteps.createdAt,
      })
      .from(approvalSteps)
      .where(ctx.scope.where(approvalSteps, eq(approvalSteps.action, "submit")))
      .orderBy(approvalSteps.quoteId, desc(approvalSteps.createdAt))
      .as("submitted")

    const definitions: Record<InsightKey, SQL> = {
      pending_approval: inArray(quotes.status, PENDING_APPROVAL_STATUSES),
      high_value_pipeline: inArray(quotes.status, PIPELINE_STATUSES),
      low_margin: and(
        inArray(quotes.status, LOW_MARGIN_STATUSES),
        marginBelow(LOW_MARGIN_THRESHOLD)
      )!,
      valid_until_soon: and(
        inArray(quotes.status, VALID_UNTIL_STATUSES),
        gte(quotes.validUntil, validUntilSoon.from),
        lte(quotes.validUntil, validUntilSoon.to)
      )!,
      this_month: gte(quotes.createdAt, utcDayStart(thisMonthFrom)),
      rejected: inArray(quotes.status, REJECTED_STATUSES),
    }
    const aggregates = Object.fromEntries(
      INSIGHT_KEYS.flatMap((key) => [
        [
          `${key}Count`,
          sql<number>`count(*) filter (where ${definitions[key]})`.mapWith(
            Number
          ),
        ],
        [
          `${key}Value`,
          sql<string>`coalesce(sum(${quotes.total}) filter (where ${definitions[key]}), 0)`,
        ],
      ])
    ) as Record<`${InsightKey}${"Count" | "Value"}`, SQL.Aliased | SQL>

    const [[totals], byStatus, recent] = await Promise.all([
      ctx.scope.db
        .select({
          ...aggregates,
          // Epoch ms of the longest wait (a Quote without a submit step,
          // e.g. imported, counts from its last change).
          oldestSubmittedAt: sql<
            number | null
          >`extract(epoch from min(coalesce(${submitted.submittedAt}, ${quotes.updatedAt})) filter (where ${definitions.pending_approval})) * 1000`,
        })
        .from(quotes)
        .leftJoin(submitted, eq(submitted.quoteId, quotes.id))
        .where(ctx.scope.where(quotes)),
      ctx.scope.db
        .select({ status: quotes.status, n: count() })
        .from(quotes)
        .where(ctx.scope.where(quotes))
        .groupBy(quotes.status),
      ctx.scope.db
        .select({
          id: quotes.id,
          name: quotes.name,
          status: quotes.status,
          currencyCode: quotes.currencyCode,
          total: quotes.total,
          updatedAt: quotes.updatedAt,
          customer: { id: customers.id, name: customers.name },
        })
        .from(quotes)
        .innerJoin(
          customers,
          and(
            eq(customers.organizationId, quotes.organizationId),
            eq(customers.id, quotes.customerId)
          )
        )
        .where(
          and(
            ctx.scope.where(
              quotes,
              or(
                eq(quotes.createdById, ctx.user.id),
                eq(quotes.updatedById, ctx.user.id)
              )
            ),
            ctx.scope.where(customers)
          )
        )
        .orderBy(desc(quotes.updatedAt), desc(quotes.id))
        .limit(RECENT_QUOTES_LIMIT),
    ])

    const row = totals as unknown as Record<string, unknown>
    const oldestSubmittedAt =
      row.oldestSubmittedAt == null
        ? null
        : new Date(Math.round(Number(row.oldestSubmittedAt)))
    const cards = INSIGHT_KEYS.map((key) => {
      const n = Number(row[`${key}Count`] ?? 0)
      const pending = key === "pending_approval"
      const oldestAgeDays =
        pending && oldestSubmittedAt
          ? ageInDays(oldestSubmittedAt.getTime(), now.getTime())
          : null
      return {
        key,
        /** How many Quotes the card counts. */
        count: n,
        /** The sum of their Totals (4 dp). */
        value: toMoneyString(String(row[`${key}Value`] ?? "0")),
        severity: insightSeverity(key, { count: n, oldestAgeDays }),
        /** Pending approval only: when the longest-waiting Quote was submitted… */
        oldestSubmittedAt: pending ? oldestSubmittedAt : null,
        /** …and the whole days it has waited. */
        oldestAgeDays,
      }
    })

    const statusCounts = Object.fromEntries(
      QUOTE_STATUSES.map((status) => [
        status,
        byStatus.find((s) => s.status === status)?.n ?? 0,
      ])
    ) as Record<QuoteStatus, number>

    return {
      currencyCode: ctx.organization.currencyCode,
      thisMonthFrom,
      today,
      cards,
      statusCounts,
      recent,
    }
  }),
}
