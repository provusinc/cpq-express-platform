/**
 * `quote.costChangeLog`, registered on the `quote` router: the Quote's cost
 * change log, written by Cost Propagation (`../cost-propagation.ts`).
 */
import { z } from "zod"

import { and, desc, eq, schema } from "@workspace/db"

import { notFound } from "../errors"
import { organizationProcedure } from "../trpc"

const { costChangeLog, lineItems, quotes, users } = schema

export const quoteCostChangeLogProcedures = {
  /**
   * Why the Quote's margins moved: one entry per Line Item whose Base Rate
   * cost Cost Propagation rewrote, newest first, with the line (its current
   * name), the source (kind and name at the time), old → new cost, who
   * changed the cost and when. Every member may read it.
   */
  costChangeLog: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const quote = await ctx.scope.findById(quotes, input.id)
      if (!quote) throw notFound("Quote")
      const entries = await ctx.scope.db
        .select({
          id: costChangeLog.id,
          lineItemId: costChangeLog.lineItemId,
          lineName: lineItems.name,
          sourceKind: costChangeLog.sourceKind,
          sourceId: costChangeLog.sourceId,
          sourceName: costChangeLog.sourceName,
          oldCost: costChangeLog.oldCost,
          newCost: costChangeLog.newCost,
          createdAt: costChangeLog.createdAt,
          actor: { id: users.id, name: users.name, email: users.email },
        })
        .from(costChangeLog)
        .innerJoin(
          lineItems,
          and(
            eq(lineItems.organizationId, costChangeLog.organizationId),
            eq(lineItems.id, costChangeLog.lineItemId)
          )
        )
        .innerJoin(users, eq(users.id, costChangeLog.actorId))
        .where(
          ctx.scope.where(costChangeLog, eq(costChangeLog.quoteId, quote.id))
        )
        .orderBy(desc(costChangeLog.createdAt), desc(costChangeLog.id))
      return { quoteId: quote.id, currencyCode: quote.currencyCode, entries }
    }),
}
