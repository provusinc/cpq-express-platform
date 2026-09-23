/**
 * Quote deletion, spread into the `quote` router: `quote.delete` and the
 * list's bulk `quote.deleteMany`.
 *
 * A delete is permanent (there is no undo). It runs through
 * `quoteCommand(…, "quote.delete", …)`, so only the Quote Owner or an Admin
 * may delete, and only while the Quote's status is in the Organization's
 * deletable statuses (FORBIDDEN / PRECONDITION_FAILED otherwise). The
 * database cascades the delete to every child row (Phases, Line Items,
 * Allocations, Milestones, undo snapshots, Approval Steps, Quote Documents
 * and cost log entries). Storage objects aren't rows, so the Quote
 * Documents' keys are read inside the command (`quoteDocumentKeys`) and the
 * objects removed once it has committed (`removeQuoteDocumentObjects`).
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { eq, inArray, schema } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import type { Actor } from "@workspace/domain/policy"
import type { ObjectStorage } from "@workspace/storage"

import { removeQuoteDocumentObjects } from "../documents"
import { notFound } from "../errors"
import { quoteCommand } from "../quotes"
import { organizationProcedure } from "../trpc"

const { quoteDocuments, quotes } = schema

/** The most Quotes one bulk delete takes (the list's largest page). */
export const QUOTE_DELETE_MANY_MAX = 100

/**
 * The storage keys of the Quote's Documents, which a delete must remove
 * from object storage (the rows themselves cascade).
 */
export async function quoteDocumentKeys(
  scope: OrganizationScope,
  quoteId: string
): Promise<string[]> {
  const rows = await scope.db
    .select({ storageKey: quoteDocuments.storageKey })
    .from(quoteDocuments)
    .where(scope.where(quoteDocuments, eq(quoteDocuments.quoteId, quoteId)))
  return rows.map((row) => row.storageKey)
}

/** Deletes one Quote (checked by `quoteCommand`), then its objects. */
async function deleteQuote(
  ctx: { scope: OrganizationScope; actor: Actor; storage: ObjectStorage },
  id: string
): Promise<{ id: string; name: string }> {
  const { deleted, keys } = await quoteCommand(
    ctx,
    id,
    "quote.delete",
    async (cmd) => {
      const keys = await quoteDocumentKeys(cmd.scope, cmd.quote.id)
      await cmd.scope.delete(quotes, cmd.quote.id)
      return { deleted: { id: cmd.quote.id, name: cmd.quote.name }, keys }
    }
  )
  // After the commit: a failed removal only leaves an orphaned object.
  await removeQuoteDocumentObjects(ctx.storage, keys)
  return deleted
}

/** Refusals a bulk delete reports per Quote instead of failing. */
const SKIP_CODES: readonly TRPCError["code"][] = [
  "FORBIDDEN",
  "PRECONDITION_FAILED",
  "NOT_FOUND",
]

export const quoteDeleteProcedures = {
  /**
   * Permanently deletes a Quote and everything under it (see the module
   * comment). Owner or Admin, in a deletable status only. Returns the
   * deleted Quote's `{ id, name }`.
   */
  delete: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) => deleteQuote(ctx, input.id)),

  /**
   * Bulk delete from the Quote list: applies `quote.delete`'s rules to each
   * Quote on its own (each in its own transaction, in the order given) and
   * reports what happened: `deleted` Quotes and `skipped` ones with the
   * refusal's message as `reason` (not the owner or an Admin, a status
   * that isn't deletable, or deleted meanwhile). NOT_FOUND for the whole
   * call if any id isn't one of this Organization's Quotes.
   */
  deleteMany: organizationProcedure
    .input(
      z.object({
        ids: z.array(z.uuid()).min(1).max(QUOTE_DELETE_MANY_MAX),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ids = [...new Set(input.ids)]
      const found = await ctx.scope.findMany(quotes, {
        where: inArray(quotes.id, ids),
      })
      if (found.length !== ids.length) throw notFound("Quote")
      const names = new Map(found.map((q) => [q.id, q.name]))

      const deleted: { id: string; name: string }[] = []
      const skipped: { id: string; name: string; reason: string }[] = []
      for (const id of ids) {
        try {
          deleted.push(await deleteQuote(ctx, id))
        } catch (error) {
          if (!(error instanceof TRPCError) || !SKIP_CODES.includes(error.code))
            throw error
          skipped.push({
            id,
            name: names.get(id)!,
            reason:
              error.code === "NOT_FOUND"
                ? "It was deleted meanwhile."
                : error.message,
          })
        }
      }
      return { deleted, skipped }
    }),
}
