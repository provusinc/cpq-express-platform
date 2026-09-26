/**
 * `quote.insights`, registered on the `quote` router: the Key Insight cards
 * at the top of the Dashboard, the count per Stage and the caller's recent
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
import { QUOTE_STAGES } from "@workspace/domain/enums"
import type { QuoteStage } from "@workspace/domain/enums"
import {
  ageInDays,
  VALID_UNTIL_STAGES,
  validUntilWindow,
  INSIGHT_KEYS,
  insightSeverity,
  LOW_MARGIN_STAGES,
  LOW_MARGIN_THRESHOLD,
  PENDING_APPROVAL_STAGES,
  PIPELINE_STAGES,
  startOfUtcMonth,
  utcDay,
} from "@workspace/domain/insights"
import type { InsightKey } from "@workspace/domain/insights"
import { toMoneyString } from "@workspace/domain/money"

import { quoteRejected } from "../quotes"
import { organizationProcedure } from "../trpc"

const { customers, approvalSteps, quoteStatuses, quotes } = schema

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
   * - `pending_approval`: Quotes In Approval, their value and the oldest
   *   wait, measured from each Quote's latest submit Approval Step;
   * - `high_value_pipeline`: Draft + In Approval, count and value;
   * - `low_margin`: Margin % < 15 with Total > 0, not Decided (Draft or In
   *   Approval);
   * - `valid_until_soon`: Valid Until from today to 14 days ahead, on an
   *   offer still in play (Draft, In Approval, Approved, With Customer);
   * - `this_month`: Quotes created since the start of this UTC month;
   * - `rejected`: Rejected Quotes (a Draft whose latest Approval Step is a
   *   rejection, by an Approver or the customer).
   * Each card carries its domain severity. Also the count per Stage (every
   * Stage, zeros included), `thisMonthFrom` (the month's first day) and
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
      pending_approval: inArray(quotes.stage, PENDING_APPROVAL_STAGES),
      high_value_pipeline: inArray(quotes.stage, PIPELINE_STAGES),
      low_margin: and(
        inArray(quotes.stage, LOW_MARGIN_STAGES),
        marginBelow(LOW_MARGIN_THRESHOLD)
      )!,
      valid_until_soon: and(
        inArray(quotes.stage, VALID_UNTIL_STAGES),
        gte(quotes.validUntil, validUntilSoon.from),
        lte(quotes.validUntil, validUntilSoon.to)
      )!,
      this_month: gte(quotes.createdAt, utcDayStart(thisMonthFrom)),
      rejected: sql`${quoteRejected}`,
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

    const [[totals], byStage, recent] = await Promise.all([
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
        .select({ stage: quotes.stage, n: count() })
        .from(quotes)
        .where(ctx.scope.where(quotes))
        .groupBy(quotes.stage),
      ctx.scope.db
        .select({
          id: quotes.id,
          name: quotes.name,
          stage: quotes.stage,
          status: {
            id: quoteStatuses.id,
            name: quoteStatuses.name,
            colour: quoteStatuses.colour,
          },
          rejected: quoteRejected,
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
        .innerJoin(
          quoteStatuses,
          and(
            eq(quoteStatuses.organizationId, quotes.organizationId),
            eq(quoteStatuses.id, quotes.statusId)
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

    const stageCounts = Object.fromEntries(
      QUOTE_STAGES.map((stage) => [
        stage,
        byStage.find((s) => s.stage === stage)?.n ?? 0,
      ])
    ) as Record<QuoteStage, number>

    return {
      currencyCode: ctx.organization.currencyCode,
      thisMonthFrom,
      today,
      cards,
      stageCounts,
      recent,
    }
  }),
}
