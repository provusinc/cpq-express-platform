/**
 * `dashboard.overview`: everything on the Dashboard besides the Key
 * Insights (`quote.insights`), aggregated in SQL for the whole
 * Organization (every member sees every Quote). The rules — which
 * statuses are open, the win rate, the expiring window, low margin — are
 * the domain's (`@workspace/domain/dashboard`, `…/insights`).
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  schema,
  sql,
} from "@workspace/db"
import {
  DASHBOARD_LIST_LIMIT,
  DASHBOARD_MONTHS,
  fillMonths,
  LOST_STATUS,
  OPEN_STATUSES,
  recentUtcMonths,
  winRate,
  WON_STATUS,
} from "@workspace/domain/dashboard"
import { QUOTE_STATUSES } from "@workspace/domain/enums"
import {
  ageInDays,
  daysUntil,
  EXPIRING_STATUSES,
  expiringWindow,
  LOW_MARGIN_STATUSES,
  LOW_MARGIN_THRESHOLD,
  utcDay,
} from "@workspace/domain/insights"
import { toMoneyString } from "@workspace/domain/money"

import { createTRPCRouter, organizationProcedure } from "../trpc"
import { marginBelow } from "./quote-insights"

const { accounts, approvalSteps, quotes, users } = schema

export const dashboardRouter = createTRPCRouter({
  /**
   * The Dashboard's figures, computed now (months and days are UTC):
   * - `pipeline`: every status with its Quote count and summed Total;
   * - `months`: Quotes created per month over the last `DASHBOARD_MONTHS`
   *   (this one included, zeros filled) with their summed Total;
   * - `outcomes`: Customer Approved vs Customer Rejected, counts, values
   *   and the win rate (null before the first outcome);
   * - `approvalQueue`: the Pending Approval Quotes, longest wait first
   *   (from each Quote's latest submit step), `canReview` when the caller
   *   is an Approver who doesn't own it, plus `total` and `waitingForMe`;
   * - `lowMargin`: undecided Quotes with Margin % below the threshold and a
   *   positive Total, lowest margin first;
   * - `expiring`: offers in play whose Valid Until is within the expiring
   *   window, soonest first, with `daysLeft`;
   * - `topAccounts`: the Accounts with the largest open Total (no customer
   *   outcome yet), with their open Quote count.
   * Lists hold at most `DASHBOARD_LIST_LIMIT` rows.
   */
  overview: organizationProcedure.query(async ({ ctx }) => {
    const now = Date.now()
    const today = utcDay(now)
    const window = expiringWindow(today)
    const months = recentUtcMonths(now, DASHBOARD_MONTHS)
    const limit = DASHBOARD_LIST_LIMIT
    const accountJoin = and(
      eq(accounts.organizationId, quotes.organizationId),
      eq(accounts.id, quotes.accountId)
    )
    const month = sql<string>`to_char(date_trunc('month', ${quotes.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`

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
    const waitingSince = sql<Date>`coalesce(${submitted.submittedAt}, ${quotes.updatedAt})`

    /** The columns of a Quote row in a Dashboard list. */
    const quoteRow = {
      id: quotes.id,
      name: quotes.name,
      status: quotes.status,
      currencyCode: quotes.currencyCode,
      total: quotes.total,
      marginPct: quotes.marginPct,
      validUntil: quotes.validUntil,
      account: { id: accounts.id, name: accounts.name },
      owner: { id: users.id, name: users.name, email: users.email },
    }
    const quoteList = () =>
      ctx.scope.db
        .select(quoteRow)
        .from(quotes)
        .innerJoin(accounts, accountJoin)
        .innerJoin(users, eq(users.id, quotes.ownerId))

    const [
      byStatus,
      byMonth,
      queue,
      [queueCounts],
      lowMargin,
      expiring,
      topAccounts,
    ] = await Promise.all([
      ctx.scope.db
        .select({
          status: quotes.status,
          count: count(),
          value: sql<string>`coalesce(sum(${quotes.total}), 0)`,
        })
        .from(quotes)
        .where(ctx.scope.where(quotes))
        .groupBy(quotes.status),
      ctx.scope.db
        .select({
          month,
          count: count(),
          value: sql<string>`coalesce(sum(${quotes.total}), 0)`,
        })
        .from(quotes)
        .where(
          ctx.scope.where(
            quotes,
            gte(quotes.createdAt, new Date(`${months[0]}T00:00:00.000Z`))
          )
        )
        .groupBy(month),
      ctx.scope.db
        .select({ ...quoteRow, submittedAt: waitingSince })
        .from(quotes)
        .innerJoin(accounts, accountJoin)
        .innerJoin(users, eq(users.id, quotes.ownerId))
        .leftJoin(submitted, eq(submitted.quoteId, quotes.id))
        .where(
          and(
            ctx.scope.where(quotes, eq(quotes.status, "pending_approval")),
            ctx.scope.where(accounts)
          )
        )
        .orderBy(asc(waitingSince), asc(quotes.id))
        .limit(limit),
      ctx.scope.db
        .select({
          total: count(),
          waitingForMe:
            sql<number>`count(*) filter (where ${quotes.ownerId} <> ${ctx.user.id})`.mapWith(
              Number
            ),
        })
        .from(quotes)
        .where(ctx.scope.where(quotes, eq(quotes.status, "pending_approval"))),
      quoteList()
        .where(
          and(
            ctx.scope.where(
              quotes,
              inArray(quotes.status, LOW_MARGIN_STATUSES),
              marginBelow(LOW_MARGIN_THRESHOLD)
            ),
            ctx.scope.where(accounts)
          )
        )
        .orderBy(asc(quotes.marginPct), desc(quotes.total), asc(quotes.id))
        .limit(limit),
      quoteList()
        .where(
          and(
            ctx.scope.where(
              quotes,
              inArray(quotes.status, EXPIRING_STATUSES),
              gte(quotes.validUntil, window.from),
              lte(quotes.validUntil, window.to)
            ),
            ctx.scope.where(accounts)
          )
        )
        .orderBy(asc(quotes.validUntil), desc(quotes.total), asc(quotes.id))
        .limit(limit),
      ctx.scope.db
        .select({
          id: accounts.id,
          name: accounts.name,
          count: count(),
          value: sql<string>`sum(${quotes.total})`,
        })
        .from(quotes)
        .innerJoin(accounts, accountJoin)
        .where(
          and(
            ctx.scope.where(quotes, inArray(quotes.status, OPEN_STATUSES)),
            ctx.scope.where(accounts)
          )
        )
        .groupBy(accounts.id, accounts.name)
        .orderBy(desc(sql`sum(${quotes.total})`), asc(accounts.name))
        .limit(limit),
    ])

    const pipeline = QUOTE_STATUSES.map((status) => {
      const row = byStatus.find((s) => s.status === status)
      return {
        status,
        count: row?.count ?? 0,
        value: toMoneyString(row?.value ?? "0"),
      }
    })
    const won = pipeline.find((p) => p.status === WON_STATUS)!
    const lost = pipeline.find((p) => p.status === LOST_STATUS)!
    const canApprove = ctx.membership.isApprover

    return {
      currencyCode: ctx.organization.currencyCode,
      today,
      expiringTo: window.to,
      isApprover: canApprove,
      pipeline,
      months: fillMonths(months, byMonth),
      outcomes: {
        won: { count: won.count, value: won.value },
        lost: { count: lost.count, value: lost.value },
        winRate: winRate(won.count, lost.count),
      },
      approvalQueue: {
        total: queueCounts?.total ?? 0,
        /** Pending Approval Quotes the caller doesn't own. */
        waitingForMe: canApprove ? (queueCounts?.waitingForMe ?? 0) : 0,
        rows: queue.map((row) => {
          const since = new Date(row.submittedAt)
          return {
            ...row,
            submittedAt: since,
            ageDays: ageInDays(since.getTime(), now),
            /** The caller owns it. */
            mine: row.owner.id === ctx.user.id,
            canReview: canApprove && row.owner.id !== ctx.user.id,
          }
        }),
      },
      lowMargin,
      expiring: expiring.map((row) => ({
        ...row,
        daysLeft: daysUntil(row.validUntil!, today),
      })),
      topAccounts: topAccounts.map((row) => ({
        ...row,
        value: toMoneyString(row.value),
      })),
    }
  }),
})
