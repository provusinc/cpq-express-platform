/**
 * The Organization's Quote Statuses (glossary: Quote Status, ADR-0004):
 * labels inside the fixed Quote Stages, which carry no behaviour. For now
 * every Organization has the defaults, one per Stage; managing them is a
 * Settings feature (#33).
 */
import { asc, schema, sql } from "@workspace/db"

import { createTRPCRouter, organizationProcedure } from "../trpc"

const { quoteStatuses } = schema

export const quoteStatusRouter = createTRPCRouter({
  /**
   * Every Status of the Organization, in Stage order and then their order
   * within the Stage (`sequence`, then name): what the Quote list's Status
   * filter offers, grouped by Stage. Any member.
   */
  list: organizationProcedure.query(({ ctx }) =>
    ctx.scope.db
      .select({
        id: quoteStatuses.id,
        stage: quoteStatuses.stage,
        name: quoteStatuses.name,
        sequence: quoteStatuses.sequence,
        colour: quoteStatuses.colour,
      })
      .from(quoteStatuses)
      .where(ctx.scope.where(quoteStatuses))
      .orderBy(
        asc(quoteStatuses.stage),
        asc(quoteStatuses.sequence),
        asc(sql`lower(${quoteStatuses.name})`),
        asc(quoteStatuses.id)
      )
  ),
})
