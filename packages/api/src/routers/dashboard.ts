/**
 * `dashboard.overview`: everything on the Dashboard besides the Key
 * Insights and the recent Quotes (`quote.insights`), aggregated in SQL
 * for the whole Organization (every member sees every Quote), and
 * `dashboard.valueOverTime`, the Quote value chart. The rules — which
 * statuses are open, the chart's ranges and buckets — are the domain's
 * (`@workspace/domain/dashboard`).
 */
import { z } from "zod"

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
  OPEN_STATUSES,
  VALUE_RANGES,
  valueBuckets,
} from "@workspace/domain/dashboard"
import { ageInDays } from "@workspace/domain/insights"
import { toMoneyString } from "@workspace/domain/money"

import { createTRPCRouter, organizationProcedure } from "../trpc"

const { customers, approvalSteps, quotes, users } = schema

export const dashboardRouter = createTRPCRouter({
  /**
   * The Dashboard's figures, computed now (months and days are UTC):
   * - `open`: the Quotes without a customer outcome yet, counted and their
   *   Totals summed (the header's pipeline figure);
   * - `approvalQueue`: the Pending Approval Quotes that need the caller —
   *   for an Approver the ones waiting for them (not their own), for
   *   anyone else their own — longest wait first (from each Quote's
   *   latest submit step), at most `DASHBOARD_LIST_LIMIT` rows, with the
   *   `total` count.
   */
  overview: organizationProcedure.query(async ({ ctx }) => {
    const now = Date.now()
    const isApprover = ctx.membership.isApprover

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

    const [[open], queue, [queueCount]] = await Promise.all([
      ctx.scope.db
        .select({
          count: count(),
          value: sql<string>`coalesce(sum(${quotes.total}), 0)`,
        })
        .from(quotes)
        .where(ctx.scope.where(quotes, inArray(quotes.status, OPEN_STATUSES))),
      ctx.scope.db
        .select({
          id: quotes.id,
          name: quotes.name,
          currencyCode: quotes.currencyCode,
          total: quotes.total,
          customer: { id: customers.id, name: customers.name },
          owner: { id: users.id, name: users.name, email: users.email },
          submittedAt: waitingSince,
        })
        .from(quotes)
        .innerJoin(
          customers,
          and(
            eq(customers.organizationId, quotes.organizationId),
            eq(customers.id, quotes.customerId)
          )
        )
        .innerJoin(users, eq(users.id, quotes.ownerId))
        .leftJoin(submitted, eq(submitted.quoteId, quotes.id))
        .where(and(inQueue, ctx.scope.where(customers)))
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

  /**
   * The Quote value chart: per UTC bucket of `range` (days or weeks, the
   * domain's `valueBuckets`, oldest first, zero-filled in SQL with
   * `generate_series`), the Quotes `created` in it and the Quotes that
   * reached Customer Approved in it (dated by that Approval Step; the
   * status is final, so a Quote counts once), each counted with their
   * Totals summed (4 dp).
   */
  valueOverTime: organizationProcedure
    .input(z.object({ range: z.enum(VALUE_RANGES) }))
    .query(async ({ ctx, input }) => {
      const { unit, from, last } = valueBuckets(Date.now(), input.range)
      const since = new Date(`${from}T00:00:00.000Z`)
      // `unit` is the domain's "day" | "week", never user text.
      const bucketOf = (
        at: typeof quotes.createdAt | typeof approvalSteps.createdAt
      ) =>
        sql<string>`date_trunc('${sql.raw(unit)}', ${at} at time zone 'UTC')::date`

      const created = ctx.scope.db
        .select({
          bucket: bucketOf(quotes.createdAt).as("bucket"),
          count: count().as("count"),
          value: sql<string>`sum(${quotes.total})`.as("value"),
        })
        .from(quotes)
        .where(ctx.scope.where(quotes, gte(quotes.createdAt, since)))
        .groupBy(sql`1`)
        .as("created")
      const approved = ctx.scope.db
        .select({
          bucket: bucketOf(approvalSteps.createdAt).as("bucket"),
          count: count().as("count"),
          value: sql<string>`sum(${quotes.total})`.as("value"),
        })
        .from(approvalSteps)
        .innerJoin(
          quotes,
          and(
            eq(quotes.organizationId, approvalSteps.organizationId),
            eq(quotes.id, approvalSteps.quoteId)
          )
        )
        .where(
          and(
            ctx.scope.where(
              approvalSteps,
              eq(approvalSteps.toStatus, "customer_approved"),
              gte(approvalSteps.createdAt, since)
            ),
            ctx.scope.where(quotes)
          )
        )
        .groupBy(sql`1`)
        .as("approved")

      // Qualified by hand: drizzle leaves a subquery's aliased fields bare
      // when the outer `from` is raw SQL, and "bucket" is in all three.
      const bucket = sql`buckets.bucket`
      const col = (from: "created" | "approved", field: string) =>
        sql.raw(`"${from}"."${field}"`)
      const rows = await ctx.scope.db
        .select({
          start: sql<string>`to_char(${bucket}, 'YYYY-MM-DD')`,
          createdCount: sql<number>`coalesce(${col("created", "count")}, 0)::int`,
          createdValue: sql<string>`coalesce(${col("created", "value")}, 0)`,
          approvedCount: sql<number>`coalesce(${col("approved", "count")}, 0)::int`,
          approvedValue: sql<string>`coalesce(${col("approved", "value")}, 0)`,
        })
        .from(
          sql`generate_series(${from}::date, ${last}::date, ${`1 ${unit}`}::interval) as buckets(bucket)`
        )
        .leftJoin(created, sql`${col("created", "bucket")} = ${bucket}`)
        .leftJoin(approved, sql`${col("approved", "bucket")} = ${bucket}`)
        .orderBy(bucket)

      return {
        range: input.range,
        unit,
        buckets: rows.map((row) => ({
          start: row.start,
          created: {
            count: row.createdCount,
            value: toMoneyString(row.createdValue),
          },
          approved: {
            count: row.approvedCount,
            value: toMoneyString(row.approvedValue),
          },
        })),
      }
    }),
})
