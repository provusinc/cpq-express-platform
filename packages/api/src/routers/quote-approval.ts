/**
 * The Quote's approval procedures, registered on the `quote` router
 * (`quote.submit`, `quote.approve`, `quote.reject`, `quote.recall`,
 * `quote.approvalHistory`, `quote.awaitingMyApproval`). They live in their
 * own file so the lifecycle stays in one place; see `../approval.ts`.
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { and, asc, count, desc, eq, ne, schema, sql } from "@workspace/db"

import { transitionInput, transitionQuote } from "../approval"
import { notFound } from "../errors"
import { paging } from "../inputs"
import { quoteCommand } from "../quotes"
import { organizationProcedure } from "../trpc"

const { accounts, approvalSteps, quotes, users } = schema

export const quoteApprovalProcedures = {
  /**
   * Submission: the Quote Owner asks for approval of a Draft, Rejected or
   * Customer Rejected Quote with a positive Total; it moves to Pending
   * Approval (and is locked). Each failed precondition has its own
   * message (wrong status, zero or negative Total). Optional comment.
   */
  submit: organizationProcedure
    .input(transitionInput)
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.id, "quote.submit", (cmd) =>
        transitionQuote(cmd, "submit", input.comment)
      )
    ),

  /**
   * An Approver approves a Pending Approval Quote (never their own):
   * Approved. Optional comment.
   */
  approve: organizationProcedure
    .input(transitionInput)
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.id, "quote.approve", (cmd) =>
        transitionQuote(cmd, "approve", input.comment)
      )
    ),

  /**
   * An Approver rejects a Pending Approval Quote (never their own):
   * Rejected, which unlocks it for editing and resubmission. Optional
   * comment (the reason).
   */
  reject: organizationProcedure
    .input(transitionInput)
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.id, "quote.reject", (cmd) =>
        transitionQuote(cmd, "reject", input.comment)
      )
    ),

  /**
   * Recall: the Quote Owner or an Admin withdraws a Submission while it is
   * Pending Approval; the Quote returns to Draft. Optional comment.
   */
  recall: organizationProcedure
    .input(transitionInput)
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.id, "quote.recall", (cmd) =>
        transitionQuote(cmd, "recall", input.comment)
      )
    ),

  /**
   * The Quote's approval history: every Approval Step, oldest first, with
   * its actor. Every member may read it.
   */
  approvalHistory: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const quote = await ctx.scope.findById(quotes, input.id)
      if (!quote) throw notFound("Quote")
      const steps = await ctx.scope.db
        .select({
          id: approvalSteps.id,
          action: approvalSteps.action,
          fromStatus: approvalSteps.fromStatus,
          toStatus: approvalSteps.toStatus,
          comment: approvalSteps.comment,
          createdAt: approvalSteps.createdAt,
          actor: { id: users.id, name: users.name, email: users.email },
        })
        .from(approvalSteps)
        .innerJoin(users, eq(users.id, approvalSteps.actorId))
        .where(
          ctx.scope.where(approvalSteps, eq(approvalSteps.quoteId, quote.id))
        )
        .orderBy(asc(approvalSteps.createdAt), asc(approvalSteps.id))
      return { quoteId: quote.id, steps }
    }),

  /**
   * "Awaiting my approval": Pending Approval Quotes the caller may decide,
   * i.e. every one they don't own, longest-waiting first, with when (and
   * by whom) each was submitted. Approvers only (FORBIDDEN otherwise).
   */
  awaitingMyApproval: organizationProcedure
    .input(z.object({ ...paging }))
    .query(async ({ ctx, input }) => {
      if (!ctx.actor.isApprover) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an Approver can approve or reject.",
        })
      }
      const where = ctx.scope.where(
        quotes,
        eq(quotes.status, "pending_approval"),
        ne(quotes.ownerId, ctx.user.id)
      )
      // The latest submit step of each Quote: when it entered the queue.
      const submitted = ctx.scope.db
        .selectDistinctOn([approvalSteps.quoteId], {
          quoteId: approvalSteps.quoteId,
          submittedAt: approvalSteps.createdAt,
          comment: approvalSteps.comment,
        })
        .from(approvalSteps)
        .where(
          ctx.scope.where(approvalSteps, eq(approvalSteps.action, "submit"))
        )
        .orderBy(approvalSteps.quoteId, desc(approvalSteps.createdAt))
        .as("submitted")
      const [rows, [total]] = await Promise.all([
        ctx.scope.db
          .select({
            id: quotes.id,
            name: quotes.name,
            currencyCode: quotes.currencyCode,
            total: quotes.total,
            marginPct: quotes.marginPct,
            startDate: quotes.startDate,
            endDate: quotes.endDate,
            account: { id: accounts.id, name: accounts.name },
            owner: { id: users.id, name: users.name, email: users.email },
            submittedAt: submitted.submittedAt,
            submitComment: submitted.comment,
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
          .where(where)
          .orderBy(
            sql`${submitted.submittedAt} asc nulls first`,
            asc(quotes.id)
          )
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        ctx.scope.db.select({ n: count() }).from(quotes).where(where),
      ])
      return {
        rows,
        total: total?.n ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      }
    }),
}
