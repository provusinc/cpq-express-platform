import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { schema, uuidv7 } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import {
  canPlacePhase,
  phaseSubtree,
  placeBefore,
  validatePhaseTree,
} from "@workspace/domain/phases"
import type { PlacementCheck } from "@workspace/domain/phases"

import { notFound } from "../errors"
import { requiredText } from "../inputs"
import {
  copyLines,
  editorResult,
  omit,
  quoteLineRows,
  quotePhases,
  restoreSnapshotLines,
  saveUndoSnapshot,
  snapshotLines,
  takeUndoSnapshot,
} from "../line-items"
import type { LinesSnapshot } from "../line-items"
import { quoteCommand } from "../quotes"
import { createTRPCRouter, organizationProcedure } from "../trpc"

const { phases } = schema

type PhaseRow = typeof phases.$inferSelect

/** The longest Phase name the API accepts. */
export const PHASE_NAME_MAX = 200

/** Undo snapshot kind written by `phase.delete`. */
const DELETE_UNDO_KIND = "phases.delete"

/** What `phase.delete` keeps so `phase.restore` can put it back. */
interface DeletedPhaseSnapshot extends LinesSnapshot {
  /** The deleted Phase first, then its descendants (parents before children). */
  phases: Array<Omit<PhaseRow, "createdAt" | "updatedAt">>
}

/** The Phase `id` among the Quote's `rows`; NOT_FOUND otherwise. */
function findPhase(rows: readonly PhaseRow[], id: string): PhaseRow {
  const phase = rows.find((p) => p.id === id)
  if (!phase) throw notFound("Phase")
  return phase
}

/** A refused placement as a tRPC error (unknown → NOT_FOUND, else BAD_REQUEST). */
function placementError(
  check: Extract<PlacementCheck, { ok: false }>
): TRPCError {
  if (check.reason === "unknown_parent" || check.reason === "unknown_phase") {
    return notFound("Phase")
  }
  return new TRPCError({ code: "BAD_REQUEST", message: check.message })
}

/**
 * Puts the Phases `order` (ids, in their new order) under `parentId` with
 * sequences 0…n−1, writing only those whose parent or sequence changed.
 * Returns the changed ids.
 */
async function resequencePhases(
  scope: OrganizationScope,
  order: readonly string[],
  current: ReadonlyMap<string, PhaseRow>,
  parentId: string | null
): Promise<string[]> {
  const changed: string[] = []
  for (const [sequence, id] of order.entries()) {
    const phase = current.get(id)
    if (phase && phase.sequence === sequence && phase.parentId === parentId) {
      continue
    }
    await scope.update(phases, id, { parentId, sequence })
    changed.push(id)
  }
  return changed
}

/** The children of `parentId` among `rows`, in sibling order. */
const siblingsOf = (rows: readonly PhaseRow[], parentId: string | null) =>
  rows.filter((p) => p.parentId === parentId).map((p) => p.id)

export const phaseRouter = createTRPCRouter({
  /**
   * Creates a Phase at the end of its siblings: top level (`parentId`
   * null/omitted) or inside a Phase of the Quote, nesting at most three
   * levels (BAD_REQUEST beyond; the domain's `canPlacePhase`).
   */
  create: organizationProcedure
    .input(
      z.object({
        quoteId: z.uuid(),
        parentId: z.uuid().nullish(),
        name: requiredText(PHASE_NAME_MAX),
      })
    )
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        const rows = await quotePhases(scope, quote.id)
        const parentId = input.parentId ?? null
        const check = canPlacePhase(rows, { parentId })
        if (!check.ok) throw placementError(check)
        const sequence =
          Math.max(
            -1,
            ...rows
              .filter((p) => p.parentId === parentId)
              .map((p) => p.sequence)
          ) + 1
        const phase = await scope.insert(phases, {
          quoteId: quote.id,
          parentId,
          name: input.name,
          sequence,
        })
        return editorResult(cmd, { phaseIds: [phase.id] })
      })
    ),

  /** Renames a Phase of the Quote. */
  rename: organizationProcedure
    .input(
      z.object({
        quoteId: z.uuid(),
        id: z.uuid(),
        name: requiredText(PHASE_NAME_MAX),
      })
    )
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const rows = await quotePhases(cmd.scope, cmd.quote.id)
        const phase = findPhase(rows, input.id)
        await cmd.scope.update(phases, phase.id, { name: input.name })
        return editorResult(cmd, { phaseIds: [phase.id] })
      })
    ),

  /**
   * Moves a Phase, with everything inside it, under `parentId` (null = top
   * level) right before the sibling `beforeId`, or at the end. Refused
   * (BAD_REQUEST) into itself or when its subtree would nest deeper than
   * three levels. Returns every Phase it renumbered.
   */
  move: organizationProcedure
    .input(
      z.object({
        quoteId: z.uuid(),
        id: z.uuid(),
        parentId: z.uuid().nullable(),
        beforeId: z.uuid().nullish(),
      })
    )
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        const rows = await quotePhases(scope, quote.id)
        const phase = findPhase(rows, input.id)
        const check = canPlacePhase(rows, {
          phaseId: phase.id,
          parentId: input.parentId,
        })
        if (!check.ok) throw placementError(check)
        const order = placeBefore(
          siblingsOf(rows, input.parentId),
          [phase.id],
          input.beforeId ?? null
        )
        if (!order) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Drop it before a sibling, or at the end.",
          })
        }
        const byId = new Map(rows.map((p) => [p.id, p]))
        const changed = await resequencePhases(
          scope,
          order,
          byId,
          input.parentId
        )
        return editorResult(cmd, { phaseIds: changed })
      })
    ),

  /**
   * Deletes a Phase with its descendant Phases and every Line Item in them
   * (and their Allocations) — the database cascades. Returns what went
   * (`deletedPhaseIds`, `deletedLineIds`) and `undoToken` for
   * `phase.restore` (valid for 10 minutes).
   */
  delete: organizationProcedure
    .input(z.object({ quoteId: z.uuid(), id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        const rows = await quotePhases(scope, quote.id)
        const phase = findPhase(rows, input.id)
        const subtree = phaseSubtree(rows, phase.id)
        const inSubtree = new Set(subtree)
        const lines = (await quoteLineRows(scope, quote.id)).filter(
          (l) => l.phaseId !== null && inSubtree.has(l.phaseId)
        )
        const byId = new Map(rows.map((p) => [p.id, p]))
        const snapshot: DeletedPhaseSnapshot = {
          ...(await snapshotLines(scope, quote, lines)),
          phases: subtree.map((id) =>
            omit(byId.get(id)!, "createdAt", "updatedAt")
          ),
        }
        await scope.delete(phases, phase.id)
        const undo = await saveUndoSnapshot(scope, {
          quoteId: quote.id,
          kind: DELETE_UNDO_KIND,
          payload: snapshot,
          userId: cmd.actor.userId,
        })
        return {
          ...(await editorResult(cmd, {
            deletedPhaseIds: subtree,
            deletedLineIds: lines.map((l) => l.id),
          })),
          ...undo,
        }
      })
    ),

  /**
   * Undoes a `phase.delete` once: the Phases (same ids, names and order),
   * their Line Items and Allocations come back. If the parent has gone (or
   * would now nest too deep), the Phase comes back at the top level.
   * Refused like `lineItem.restore` (PRECONDITION_FAILED after the Quote's
   * dates or Time Period changed or a source was deleted; NOT_FOUND for an
   * unknown or used token).
   */
  restore: organizationProcedure
    .input(z.object({ quoteId: z.uuid(), undoToken: z.uuid() }))
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        const snapshot = await takeUndoSnapshot<DeletedPhaseSnapshot>(scope, {
          token: input.undoToken,
          quoteId: quote.id,
          kind: DELETE_UNDO_KIND,
        })
        const live = await quotePhases(scope, quote.id)
        const [root, ...descendants] = snapshot.phases
        let restoredRoot = root!
        const fits = (parentId: string | null) =>
          validatePhaseTree([
            ...live,
            { ...restoredRoot, parentId },
            ...descendants,
          ]).ok
        if (restoredRoot.parentId !== null && !fits(restoredRoot.parentId)) {
          restoredRoot = {
            ...restoredRoot,
            parentId: null,
            sequence:
              Math.max(
                -1,
                ...live
                  .filter((p) => p.parentId === null)
                  .map((p) => p.sequence)
              ) + 1,
          }
        }
        const restoredPhases = await scope.insertMany(
          phases,
          [restoredRoot, ...descendants].map((p) => omit(p, "organizationId"))
        )
        const restoredLines = await restoreSnapshotLines(
          scope,
          quote,
          snapshot,
          (line) => line.phaseId
        )
        return editorResult(cmd, {
          phaseIds: restoredPhases.map((p) => p.id),
          lineIds: restoredLines.map((l) => l.id),
        })
      })
    ),

  /**
   * Clones a Phase with everything inside it — descendant Phases (parents
   * remapped), Line Items (Base Rates, prices, dates kept) and their
   * Allocations — as "Copy of {name}" right after the original. Returns the
   * new Phases and lines and every sibling it renumbered.
   */
  clone: organizationProcedure
    .input(z.object({ quoteId: z.uuid(), id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        const rows = await quotePhases(scope, quote.id)
        const phase = findPhase(rows, input.id)
        const subtree = phaseSubtree(rows, phase.id)
        const byId = new Map(rows.map((p) => [p.id, p]))
        const newId = new Map(subtree.map((id) => [id, uuidv7()]))
        const copies = subtree.map((id) => {
          const source = byId.get(id)!
          const isRoot = id === phase.id
          return {
            id: newId.get(id)!,
            quoteId: quote.id,
            parentId: isRoot ? source.parentId : newId.get(source.parentId!)!,
            name: isRoot
              ? `Copy of ${source.name}`.slice(0, PHASE_NAME_MAX)
              : source.name,
            sequence: source.sequence,
          }
        })
        const check = validatePhaseTree([...rows, ...copies])
        if (!check.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That Phase can't be cloned here.",
          })
        }
        await scope.insertMany(phases, copies)

        const inSubtree = new Set(subtree)
        const lines = (await quoteLineRows(scope, quote.id)).filter(
          (l) => l.phaseId !== null && inSubtree.has(l.phaseId)
        )
        const copiedLines = await copyLines(scope, lines, (line) => ({
          phaseId: newId.get(line.phaseId!)!,
          sequence: line.sequence,
        }))

        // The copy goes right after the original among its siblings.
        const order = siblingsOf(rows, phase.parentId).flatMap((id) =>
          id === phase.id ? [id, newId.get(id)!] : [id]
        )
        const current = new Map<string, PhaseRow>(rows.map((p) => [p.id, p]))
        const renumbered = await resequencePhases(
          scope,
          order,
          current,
          phase.parentId
        )
        return editorResult(cmd, {
          phaseIds: [...new Set([...copies.map((c) => c.id), ...renumbered])],
          lineIds: copiedLines.map((l) => l.id),
        })
      })
    ),
})
