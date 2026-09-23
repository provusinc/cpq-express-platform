import { z } from "zod"

import { schema } from "@workspace/db"
import { MILESTONE_TYPES } from "@workspace/domain/enums"
import {
  checkMilestoneColour,
  DEFAULT_MILESTONE_COLOURS,
  MILESTONE_DESCRIPTION_MAX,
  MILESTONE_NAME_MAX,
} from "@workspace/domain/milestones"

import { notFound } from "../errors"
import {
  isoDateInput,
  optionalText,
  requiredText,
  stripUndefined,
} from "../inputs"
import {
  editorResult,
  omit,
  saveUndoSnapshot,
  takeUndoSnapshot,
} from "../line-items"
import type { QuoteCommand } from "../quotes"
import { quoteCommand } from "../quotes"
import { createTRPCRouter, organizationProcedure } from "../trpc"

const { milestones } = schema

type MilestoneRow = typeof milestones.$inferSelect

/** Undo snapshot kind written by `milestone.delete`. */
const DELETE_UNDO_KIND = "milestones.delete"

/** A `#rgb` / `#rrggbb` colour, normalised to lowercase `#rrggbb`. */
const colourInput = z.string().transform((value, ctx) => {
  const check = checkMilestoneColour(value)
  if (!check.ok) {
    ctx.addIssue({ code: "custom", message: check.message })
    return z.NEVER
  }
  return check.colour
})

/** The Milestone `id` of the command's Quote; NOT_FOUND otherwise. */
async function findMilestone(
  cmd: QuoteCommand,
  id: string
): Promise<MilestoneRow> {
  const row = await cmd.scope.findById(milestones, id)
  if (!row || row.quoteId !== cmd.quote.id) throw notFound("Milestone")
  return row
}

export const milestoneRouter = createTRPCRouter({
  /**
   * Adds a Milestone to the Quote. `colour` defaults to the type's colour
   * (`DEFAULT_MILESTONE_COLOURS`); `completed` to false. The date may lie
   * outside the Quote dates (e.g. a payment due after the work ends).
   */
  create: organizationProcedure
    .input(
      z.object({
        quoteId: z.uuid(),
        name: requiredText(MILESTONE_NAME_MAX),
        date: isoDateInput,
        type: z.enum(MILESTONE_TYPES).default("milestone"),
        colour: colourInput.optional(),
        completed: z.boolean().default(false),
        description: optionalText(MILESTONE_DESCRIPTION_MAX),
      })
    )
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const row = await cmd.scope.insert(milestones, {
          quoteId: cmd.quote.id,
          name: input.name,
          date: input.date,
          type: input.type,
          colour: input.colour ?? DEFAULT_MILESTONE_COLOURS[input.type],
          completed: input.completed,
          description: input.description ?? null,
        })
        return editorResult(cmd, { milestoneIds: [row.id] })
      })
    ),

  /**
   * Edits a Milestone's fields; omitted fields keep their value (last write
   * wins per field). `description: null` (or blank) clears it.
   */
  update: organizationProcedure
    .input(
      z.object({
        quoteId: z.uuid(),
        id: z.uuid(),
        name: requiredText(MILESTONE_NAME_MAX).optional(),
        date: isoDateInput.optional(),
        type: z.enum(MILESTONE_TYPES).optional(),
        colour: colourInput.optional(),
        completed: z.boolean().optional(),
        description: optionalText(MILESTONE_DESCRIPTION_MAX),
      })
    )
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const row = await findMilestone(cmd, input.id)
        const changes = stripUndefined(omit(input, "quoteId", "id"))
        if (Object.keys(changes).length > 0) {
          await cmd.scope.update(milestones, row.id, changes)
        }
        return editorResult(cmd, { milestoneIds: [row.id] })
      })
    ),

  /** Deletes a Milestone; returns `undoToken` for `milestone.restore`. */
  delete: organizationProcedure
    .input(z.object({ quoteId: z.uuid(), id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const row = await findMilestone(cmd, input.id)
        await cmd.scope.delete(milestones, row.id)
        const undo = await saveUndoSnapshot(cmd.scope, {
          quoteId: cmd.quote.id,
          kind: DELETE_UNDO_KIND,
          payload: omit(row, "createdAt", "updatedAt"),
          userId: cmd.actor.userId,
        })
        return {
          ...(await editorResult(cmd, { deletedMilestoneIds: [row.id] })),
          ...undo,
        }
      })
    ),

  /** Undoes a `milestone.delete` once (same id and fields). */
  restore: organizationProcedure
    .input(z.object({ quoteId: z.uuid(), undoToken: z.uuid() }))
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const snapshot = await takeUndoSnapshot<
          Omit<MilestoneRow, "createdAt" | "updatedAt">
        >(cmd.scope, {
          token: input.undoToken,
          quoteId: cmd.quote.id,
          kind: DELETE_UNDO_KIND,
        })
        const row = await cmd.scope.insert(
          milestones,
          omit(snapshot, "organizationId")
        )
        return editorResult(cmd, { milestoneIds: [row.id] })
      })
    ),
})
