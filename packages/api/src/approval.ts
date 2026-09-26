/**
 * Quote lifecycle transitions (glossary: Submission, Recall, Approval Step).
 *
 * Every lifecycle command is a `quoteCommand` whose policy action
 * (`quote.submit`, `quote.approve`, …) has already checked who may act and
 * that the Stage machine allows it; its body then calls
 * `transitionQuote(cmd, stepAction, comment)`, which moves the Quote to
 * `nextStage(stage, stepAction)` (on that Stage's first Quote Status) and
 * appends the Approval Step, in the command's transaction:
 *
 *   submit: organizationProcedure
 *     .input(transitionInput)
 *     .mutation(({ ctx, input }) =>
 *       quoteCommand(ctx, input.id, "quote.submit", (cmd) =>
 *         transitionQuote(cmd, "submit", input.comment)
 *       )
 *     )
 *
 * Mark as Sent and the customer outcome use the same helper with
 * `mark_sent` / `customer_approved` (→ Won) / `customer_rejected` (→ Draft,
 * Rejected).
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { findQuoteStatus, schema, stageEntryStatus } from "@workspace/db"
import { QUOTE_STAGE_LABELS } from "@workspace/domain/enums"
import type { ApprovalStepAction } from "@workspace/domain/enums"
import { isRejected, nextStage } from "@workspace/domain/stages"

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
 * Moves the command's Quote along the Stage machine by `action`, landing it
 * on the target Stage's first Quote Status, and records the Approval Step
 * with both Stages and the Status names at the time. Returns the Quote's new
 * Stage and Status, whether it is now Rejected (a reject or the customer's
 * "no"), `updatedAt`/`updatedById` like every header command, and the step.
 */
export async function transitionQuote(
  cmd: QuoteCommand,
  action: ApprovalStepAction,
  comment?: string | null
) {
  const from = cmd.quote.stage
  const to = nextStage(from, action)
  if (!to) {
    // The policy already refused this; kept so a caller can't skip it.
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This isn't possible in the Quote's current Stage.",
    })
  }
  const [fromStatus, toStatus] = await Promise.all([
    findQuoteStatus(cmd.scope, cmd.quote.statusId),
    stageEntryStatus(cmd.scope, to),
  ])
  const quote = await cmd.update({ stage: to, statusId: toStatus.id })
  const step = await cmd.scope.insert(approvalSteps, {
    quoteId: quote.id,
    action,
    fromStage: from,
    toStage: to,
    fromStatusName: fromStatus?.name ?? QUOTE_STAGE_LABELS[from],
    toStatusName: toStatus.name,
    actorId: cmd.actor.userId,
    comment: comment || null,
  })
  return {
    id: quote.id,
    stage: quote.stage,
    status: { id: toStatus.id, name: toStatus.name },
    rejected: isRejected({ stage: quote.stage, latestAction: action }),
    updatedAt: quote.updatedAt,
    updatedById: quote.updatedById,
    step: {
      id: step.id,
      action: step.action,
      fromStage: step.fromStage,
      toStage: step.toStage,
      fromStatusName: step.fromStatusName,
      toStatusName: step.toStatusName,
      comment: step.comment,
      createdAt: step.createdAt,
    },
  }
}
