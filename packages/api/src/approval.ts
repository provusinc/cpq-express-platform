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
 * Rejected) / `mark_lost` (→ Lost); Mark as Lost is `mark_lost` with the
 * reason as the comment, and an Admin's reopen is `reopen` (Lost → Draft).
 *
 * Every transition takes an optional `statusId`: the Status of the target
 * Stage the actor picked (BAD_REQUEST when it belongs to another Stage,
 * NOT_FOUND when it isn't the Organization's); without it the Quote lands on
 * the target Stage's first Status. `changeQuoteStatus(cmd, statusId,
 * comment)` is the one non-lifecycle step: it moves the Quote to another
 * Status of its current Stage and records a `status_change` step.
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { findQuoteStatus, schema, stageEntryStatus } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import { QUOTE_STAGE_LABELS } from "@workspace/domain/enums"
import type { ApprovalStepAction, QuoteStage } from "@workspace/domain/enums"
import {
  checkEntryStatus,
  checkStatusChange,
  isRejected,
  nextStage,
  STATUS_CHANGE_ACTION,
} from "@workspace/domain/stages"

import { notFound } from "./errors"
import { optionalText } from "./inputs"
import { isQuoteRejected } from "./quotes"
import type { QuoteCommand } from "./quotes"

const { approvalSteps } = schema

/** The longest Approval Step comment the API accepts. */
export const APPROVAL_COMMENT_MAX = 2000

/**
 * The optional target Status of a transition: one of the target Stage's
 * Statuses (defaults to its first).
 */
export const targetStatusInput = z.uuid().optional()

/**
 * Input of every lifecycle command: the Quote, an optional comment and the
 * optional target Status.
 */
export const transitionInput = z.object({
  id: z.uuid(),
  comment: optionalText(APPROVAL_COMMENT_MAX),
  statusId: targetStatusInput,
})

/**
 * The Status a transition into `stage` lands on: `statusId` when given (it
 * must be one of that Stage's), else the Stage's first.
 */
async function entryStatus(
  scope: OrganizationScope,
  stage: QuoteStage,
  statusId: string | undefined
) {
  if (!statusId) return stageEntryStatus(scope, stage)
  const status = await findQuoteStatus(scope, statusId)
  if (!status) throw notFound("Quote Status")
  const check = checkEntryStatus(stage, status)
  if (!check.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: check.message })
  }
  return status
}

/**
 * Moves the command's Quote along the Stage machine by `action`, landing it
 * on `statusId` (a Status of the target Stage) or the target Stage's first
 * Quote Status, and records the Approval Step
 * with both Stages and the Status names at the time. Returns the Quote's new
 * Stage and Status, whether it is now Rejected (a reject or the customer's
 * "no"), `updatedAt`/`updatedById` like every header command, and the step.
 */
export async function transitionQuote(
  cmd: QuoteCommand,
  action: ApprovalStepAction,
  comment?: string | null,
  statusId?: string
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
    entryStatus(cmd.scope, to, statusId),
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
  return stepResult(quote, toStatus, step, {
    rejected: isRejected({ stage: quote.stage, latestAction: action }),
  })
}

/**
 * A status change: moves the command's Quote to `statusId`, another Status
 * of its current Stage (in any order; BAD_REQUEST for another Stage's or
 * the current one, NOT_FOUND for one that isn't the Organization's), and
 * records a `status_change` step with both Status names. The Stage, the
 * lock and Rejected stay as they were: moving between In Approval Statuses
 * never approves. Returns the same shape as `transitionQuote`.
 */
export async function changeQuoteStatus(
  cmd: QuoteCommand,
  statusId: string,
  comment: string | null | undefined
) {
  const [fromStatus, toStatus] = await Promise.all([
    findQuoteStatus(cmd.scope, cmd.quote.statusId),
    findQuoteStatus(cmd.scope, statusId),
  ])
  if (!toStatus) throw notFound("Quote Status")
  const check = checkStatusChange(cmd.quote, toStatus)
  if (!check.ok) {
    throw new TRPCError({ code: "BAD_REQUEST", message: check.message })
  }
  const stage = cmd.quote.stage
  const quote = await cmd.update({ statusId: toStatus.id })
  const step = await cmd.scope.insert(approvalSteps, {
    quoteId: quote.id,
    action: STATUS_CHANGE_ACTION,
    fromStage: stage,
    toStage: stage,
    fromStatusName: fromStatus?.name ?? QUOTE_STAGE_LABELS[stage],
    toStatusName: toStatus.name,
    actorId: cmd.actor.userId,
    comment: comment || null,
  })
  return stepResult(quote, toStatus, step, {
    rejected: await isQuoteRejected(cmd.scope, quote.id),
  })
}

function stepResult(
  quote: QuoteCommand["quote"],
  status: { id: string; name: string },
  step: typeof approvalSteps.$inferSelect,
  { rejected }: { rejected: boolean }
) {
  return {
    id: quote.id,
    stage: quote.stage,
    status: { id: status.id, name: status.name },
    rejected,
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
