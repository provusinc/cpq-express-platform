/**
 * `dashboard.overview`: everything on the Dashboard besides the Key
 * Insights and the recent Quotes (`quote.insights`), aggregated in SQL
 * for the whole Organization (every member sees every Quote). The rules
 * — which statuses are open, the months charted — are the domain's
 * (`@workspace/domain/dashboard`).
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  gte,
  ne,
  schema,
  sql,
} from "@workspace/db"
import {
  DASHBOARD_LIST_LIMIT,
  DASHBOARD_MONTHS,
  fillMonths,
  OPEN_STATUSES,
  recentUtcMonths,
} from "@workspace/domain/dashboard"
import { ageInDays } from "@workspace/domain/insights"
import { toMoneyString } from "@workspace/domain/money"

import { createTRPCRouter, organizationProcedure } from "../trpc"

const { accounts, approvalSteps, quotes, users } = schema

export const dashboardRouter = createTRPCRouter({
  /**
   * The Dashboard's figures, computed now (months and days are UTC):
   * - `open`: the Quotes without a customer outcome yet, counted and their
   *   Totals summed (the header's pipeline figure);
   * - `months`: Quotes created per month over the last `DASHBOARD_MONTHS`
   *   (this one included, zeros filled) with their summed Total;
   * - `approvalQueue`: the Pending Approval Quotes that need the caller —
   *   for an Approver the ones waiting for them (not their own), for
   *   anyone else their own — longest wait first (from each Quote's
   *   latest submit step), at most `DASHBOARD_LIST_LIMIT` rows, with the
   *   `total` count.
   */
  overview: organizationProcedure.query(async ({ ctx }) => {
    const now = Date.now()
    const months = recentUtcMonths(now, DASHBOARD_MONTHS)
    const isApprover = ctx.membership.isApprover
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
    const inQueue = ctx.scope.where(
      quotes,
      eq(quotes.status, "pending_approval"),
      isApprover
        ? ne(quotes.ownerId, ctx.user.id)
        : eq(quotes.ownerId, ctx.user.id)
    )

    const [[open], byMonth, queue, [queueCount]] = await Promise.all([
      ctx.scope.db
        .select({
          count: count(),
          value: sql<string>`coalesce(sum(${quotes.total}), 0)`,
        })
        .from(quotes)
        .where(ctx.scope.where(quotes, inArray(quotes.status, OPEN_STATUSES))),
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
        .select({
          id: quotes.id,
          name: quotes.name,
          currencyCode: quotes.currencyCode,
          total: quotes.total,
          account: { id: accounts.id, name: accounts.name },
          owner: { id: users.id, name: users.name, email: users.email },
          submittedAt: waitingSince,
        })
        .from(quotes)
        .innerJoin(
          accounts,
          and(
            eq(accounts.organizationId, quotes.organizationId),
            eq(accounts.id, quotes.accountId)
          )
        )
        .innerJoin(users, eq(users.id, quotes.ownerId))
        .leftJoin(submitted, eq(submitted.quoteId, quotes.id))
        .where(and(inQueue, ctx.scope.where(accounts)))
        .orderBy(asc(waitingSince), asc(quotes.id))
        .limit(DASHBOARD_LIST_LIMIT),
      ctx.scope.db.select({ total: count() }).from(quotes).where(inQueue),
    ])

    return {
      currencyCode: ctx.organization.currencyCode,
      isApprover,
      open: {
        count: open?.count ?? 0,
        value: toMoneyString(open?.value ?? "0"),
      },
      months: fillMonths(months, byMonth),
      approvalQueue: {
        total: queueCount?.total ?? 0,
        rows: queue.map((row) => {
          const since = new Date(row.submittedAt)
          return {
            ...row,
            submittedAt: since,
            ageDays: ageInDays(since.getTime(), now),
          }
        }),
      },
    }
  }),
})
