/**
 * Quote lifecycle transitions (glossary: Submission, Recall, Approval Step).
 *
 * Every lifecycle command is a `quoteCommand` whose policy action
 * (`quote.submit`, `quote.approve`, …) has already checked who may act and
 * that the Status machine allows it; its body then calls
 * `transitionQuote(cmd, stepAction, comment)`, which moves the Quote to
 * `nextStatus(status, stepAction)` and appends the Approval Step, in the
 * command's transaction:
 *
 *   submit: organizationProcedure
 *     .input(transitionInput)
 *     .mutation(({ ctx, input }) =>
 *       quoteCommand(ctx, input.id, "quote.submit", (cmd) =>
 *         transitionQuote(cmd, "submit", input.comment)
 *       )
 *     )
 *
 * Mark as Sent and the customer outcome (#22) use the same helper with
 * `mark_sent` / `customer_approved` / `customer_rejected`.
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { schema } from "@workspace/db"
import type { ApprovalStepAction } from "@workspace/domain/enums"
import { nextStatus } from "@workspace/domain/status"

import { optionalText } from "./inputs"
import type { QuoteCommand } from "./quotes"

const { approvalSteps } = schema

/** The longest Approval Step comment the API accepts. */
export const APPROVAL_COMMENT_MAX = 2000

/** Input of every lifecycle command: the Quote and an optional comment. */
export const transitionInput = z.object({
  id: z.uuid(),
  comment: optionalText(APPROVAL_COMMENT_MAX),
})

/**
 * Moves the command's Quote along the Status machine by `action` and
 * records the Approval Step. Returns the Quote's new status (plus
 * `updatedAt`/`updatedById`, like every header command) and the step.
 */
export async function transitionQuote(
  cmd: QuoteCommand,
  action: ApprovalStepAction,
  comment?: string | null
) {
  const from = cmd.quote.status
  const to = nextStatus(from, action)
  if (!to) {
    // The policy already refused this; kept so a caller can't skip it.
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This isn't possible in the Quote's current status.",
    })
  }
  const quote = await cmd.update({ status: to })
  const step = await cmd.scope.insert(approvalSteps, {
    quoteId: quote.id,
    action,
    fromStatus: from,
    toStatus: to,
    actorId: cmd.actor.userId,
    comment: comment || null,
  })
  return {
    id: quote.id,
    status: quote.status,
    updatedAt: quote.updatedAt,
    updatedById: quote.updatedById,
    step: {
      id: step.id,
      action: step.action,
      fromStatus: step.fromStatus,
      toStatus: step.toStatus,
      comment: step.comment,
      createdAt: step.createdAt,
    },
  }
}
