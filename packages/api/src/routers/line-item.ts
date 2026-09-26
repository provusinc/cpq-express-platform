import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { eq, inArray, schema } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import { resizeAllocatedEffort } from "@workspace/domain/allocations"
import type { AllocationInput } from "@workspace/domain/allocations"
import { compareDates } from "@workspace/domain/dates"
import type { IsoDate } from "@workspace/domain/dates"
import { SOURCE_KINDS } from "@workspace/domain/enums"
import { phaseTreeOrder, placeBefore } from "@workspace/domain/phases"
import { defaultLineItemQuantity } from "@workspace/domain/pricing"
import { changeLineItemStart } from "@workspace/domain/schedule"

import { writeAllocations } from "../allocations"
import { listCatalogTypes } from "../catalog-types"
import { notFound } from "../errors"
import {
  isoDateInput,
  money,
  optionalText,
  quantityInput,
  requiredText,
  stripUndefined,
} from "../inputs"
import {
  copyLines,
  editorResult,
  findQuoteLines,
  nextLineSequence,
  omit,
  quoteLineRows,
  quotePhases,
  restoreSnapshotLines,
  saveUndoSnapshot,
  snapshotLines,
  takeUndoSnapshot,
} from "../line-items"
import type { LinesSnapshot } from "../line-items"
import type { QuoteCommand } from "../quotes"
import { quoteCommand } from "../quotes"
import { getOrganizationSettings } from "../settings"
import { createTRPCRouter, organizationProcedure } from "../trpc"

const { allocations, catalogItems, lineItems, phases, resourceRoles } = schema

type LineItemRow = typeof lineItems.$inferSelect

/** The most sources one Add Items gesture may add, and lines one delete, move or clone may touch. */
export const LINE_ITEM_BATCH_MAX = 200

const NAME_MAX = 200
const TEXT_MAX = 2000

/** Undo snapshot kind written by `lineItem.delete`. */
const DELETE_UNDO_KIND = "line_items.delete"

/** Why `[start, end]` can't be a Line Item's dates on this Quote, or null. */
function lineDatesProblem(
  quote: { startDate: IsoDate; endDate: IsoDate },
  startDate: IsoDate,
  endDate: IsoDate
): string | null {
  const window = `${quote.startDate} – ${quote.endDate}`
  if (
    compareDates(startDate, quote.startDate) < 0 ||
    compareDates(startDate, quote.endDate) > 0
  ) {
    return `The start date must be within the Quote dates (${window}).`
  }
  if (
    compareDates(endDate, quote.startDate) < 0 ||
    compareDates(endDate, quote.endDate) > 0
  ) {
    return `The end date must be within the Quote dates (${window}).`
  }
  if (compareDates(endDate, startDate) < 0) {
    return "The end date can't be before the start date."
  }
  return null
}

/** NOT_FOUND unless `phaseId` is a Phase of the command's Quote. */
async function assertPhaseOfQuote(cmd: QuoteCommand, phaseId: string) {
  const phase = await cmd.scope.findById(phases, phaseId)
  if (!phase || phase.quoteId !== cmd.quote.id) throw notFound("Phase")
}

/** A Line Item's stored Allocations, by period start. */
async function lineAllocations(scope: OrganizationScope, lineId: string) {
  return scope.findMany(allocations, {
    where: eq(allocations.lineItemId, lineId),
    orderBy: [allocations.periodStart],
  })
}

/**
 * The sources for `lineItem.add`, validated: every id must be this
 * Organization's item of that kind (NOT_FOUND otherwise) and active, with
 * a Catalog Item's Catalog Type active too (PRECONDITION_FAILED: inactive
 * items stay on Quotes but can't be added).
 */
async function loadSources(
  scope: OrganizationScope,
  items: { sourceKind: (typeof SOURCE_KINDS)[number]; id: string }[]
) {
  const catalogIds = items
    .filter((i) => i.sourceKind !== "resource_role")
    .map((i) => i.id)
  const roleIds = items
    .filter((i) => i.sourceKind === "resource_role")
    .map((i) => i.id)
  const [catalog, roles, types] = await Promise.all([
    catalogIds.length
      ? scope.findMany(catalogItems, {
          where: inArray(catalogItems.id, catalogIds),
        })
      : [],
    roleIds.length
      ? scope.findMany(resourceRoles, {
          where: inArray(resourceRoles.id, roleIds),
        })
      : [],
    catalogIds.length ? listCatalogTypes(scope) : [],
  ])
  const typeById = new Map(types.map((t) => [t.id, t]))
  const catalogById = new Map(catalog.map((c) => [c.id, c]))
  const roleById = new Map(roles.map((r) => [r.id, r]))
  return items.map((item) => {
    if (item.sourceKind === "resource_role") {
      const role = roleById.get(item.id)
      if (!role) throw notFound("Resource Role")
      if (!role.active) throw inactive(role.name)
      return {
        sourceKind: item.sourceKind,
        catalogItemId: null,
        resourceRoleId: role.id,
        name: role.name,
        description: role.description,
        billingUnit: "hour" as const,
        price: role.billRate,
        cost: role.costRate,
      }
    }
    const catalogItem = catalogById.get(item.id)
    if (!catalogItem) throw notFound("Catalog Item")
    if (!catalogItem.active) throw inactive(catalogItem.name)
    const type = typeById.get(catalogItem.catalogTypeId)
    if (!type?.active) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `“${catalogItem.name}” is a ${type?.singular ?? "Catalog Item"} and that Catalog Type is inactive, so it can't be added to a Quote.`,
      })
    }
    return {
      sourceKind: item.sourceKind,
      catalogItemId: catalogItem.id,
      resourceRoleId: null,
      name: catalogItem.name,
      description: catalogItem.description,
      billingUnit: catalogItem.billingUnit,
      price: catalogItem.price,
      cost: catalogItem.cost,
    }
  })
}

const inactive = (name: string) =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `“${name}” is inactive, so it can't be added to a Quote.`,
  })

const updateInput = z.object({
  quoteId: z.uuid(),
  id: z.uuid(),
  name: requiredText(NAME_MAX).optional(),
  description: optionalText(TEXT_MAX),
  notes: optionalText(TEXT_MAX),
  startDate: isoDateInput.optional(),
  endDate: isoDateInput.optional(),
  quantity: quantityInput.optional(),
  /** A negotiated rate; `null` goes back to the Base Rate price. */
  unitPrice: money.nullable().optional(),
})

export const lineItemRouter = createTRPCRouter({
  /**
   * Adds Line Items from several sources at once (the Add Items sheet's
   * one gesture), appended in the given order, optionally into a Phase of
   * the Quote. Each line snapshots its source's current price and cost as
   * its Base Rate (unit price and cost start there), takes the Quote's
   * dates, and starts at the default quantity: one Time Period of hours at
   * the Organization's Hours Per Day for hourly lines, else 1. No
   * Allocations are created; the Resource Planner lays them out.
   */
  add: organizationProcedure
    .input(
      z.object({
        quoteId: z.uuid(),
        phaseId: z.uuid().nullish(),
        items: z
          .array(z.object({ sourceKind: z.enum(SOURCE_KINDS), id: z.uuid() }))
          .min(1)
          .max(LINE_ITEM_BATCH_MAX),
      })
    )
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        if (input.phaseId) await assertPhaseOfQuote(cmd, input.phaseId)
        const [sources, settings, sequence] = await Promise.all([
          loadSources(scope, input.items),
          getOrganizationSettings(scope),
          nextLineSequence(scope, quote.id),
        ])
        const inserted = await scope.insertMany(
          lineItems,
          sources.map((source, i) => ({
            quoteId: quote.id,
            phaseId: input.phaseId ?? null,
            sourceKind: source.sourceKind,
            catalogItemId: source.catalogItemId,
            resourceRoleId: source.resourceRoleId,
            name: source.name,
            description: source.description,
            startDate: quote.startDate,
            endDate: quote.endDate,
            billingUnit: source.billingUnit,
            basePrice: source.price,
            baseCost: source.cost,
            unitPrice: source.price,
            unitCost: source.cost,
            quantity: defaultLineItemQuantity({
              billingUnit: source.billingUnit,
              timePeriod: quote.timePeriod,
              hoursPerDay: settings.hoursPerDay,
            }),
            sequence: sequence + i,
          }))
        )
        return editorResult(cmd, { lineIds: inserted.map((l) => l.id) })
      })
    ),

  /**
   * Edits one Line Item's fields; omitted fields keep their value and only
   * the given ones are written (last write wins per field). Dates must lie
   * within the Quote dates, end on or after start. `unitPrice` overrides
   * the Base Rate price (`null` resets it); the Base Rate itself never
   * changes. On a planner-managed line (one with Allocations) a quantity
   * change resizes its Effort with the domain's rules (keeping quantity =
   * Σ Allocations); a start change lifts and shifts its Allocations by
   * whole periods (`changeLineItemStart`: the end moves with it, Effort
   * pushed past the Quote End Date is trimmed); its end date follows the
   * Allocations, so an end edit is refused (PRECONDITION_FAILED).
   */
  update: organizationProcedure.input(updateInput).mutation(({ ctx, input }) =>
    quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
      const { scope, quote } = cmd
      const [line] = await findQuoteLines(scope, quote.id, [input.id])
      const { unitPrice, ...fields } = omit(input, "quoteId", "id")
      const changes: Partial<LineItemRow> = stripUndefined(fields)
      if (unitPrice !== undefined) {
        changes.unitPrice = unitPrice ?? line!.basePrice
      }

      let current = line!
      let stored: AllocationInput[] = await lineAllocations(scope, current.id)
      const plannerManaged = stored.length > 0
      const startChanged =
        input.startDate !== undefined && input.startDate !== current.startDate
      const endChanged =
        input.endDate !== undefined && input.endDate !== current.endDate

      if (plannerManaged && endChanged) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This line's end date follows its Allocations. Change them in the Resource Planner, or move its start.",
        })
      }
      if (plannerManaged && startChanged) {
        // Lift-and-shift: the Allocations move by whole periods with the
        // start, trimmed at the Quote End Date.
        const moved = changeLineItemStart({
          quote,
          line: { ...current, allocations: stored },
          startDate: input.startDate!,
        })
        if (!moved.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: moved.message })
        }
        await writeAllocations(scope, {
          lineItemId: current.id,
          timePeriod: quote.timePeriod,
          before: stored,
          after: moved.line.allocations,
        })
        stored = moved.line.allocations
        current = {
          ...current,
          startDate: moved.line.startDate,
          endDate: moved.line.endDate,
          quantity: moved.line.quantity,
        }
        changes.startDate = current.startDate
        changes.endDate = current.endDate
        changes.quantity = current.quantity
      } else if (startChanged || endChanged) {
        const problem = lineDatesProblem(
          quote,
          input.startDate ?? current.startDate,
          input.endDate ?? current.endDate
        )
        if (problem) {
          throw new TRPCError({ code: "BAD_REQUEST", message: problem })
        }
      }

      if (plannerManaged && input.quantity !== undefined) {
        const { hoursPerDay } = await getOrganizationSettings(scope)
        const resized = resizeAllocatedEffort({
          timePeriod: quote.timePeriod,
          hoursPerDay,
          quantity: input.quantity,
          line: { ...current, allocations: stored },
          quote,
        })
        if (!resized.ok) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: resized.message,
          })
        }
        await writeAllocations(scope, {
          lineItemId: current.id,
          timePeriod: quote.timePeriod,
          before: stored,
          after: resized.allocations,
        })
        changes.quantity = resized.quantity
        changes.startDate = resized.startDate
        changes.endDate = resized.endDate
      }

      await scope.update(lineItems, line!.id, changes)
      return editorResult(cmd, { lineIds: [line!.id] })
    })
  ),

  /**
   * Deletes Line Items (one or many: a single gesture) with their
   * Allocations. NOT_FOUND unless every id is a line of this Quote. Returns
   * `undoToken` for `lineItem.restore` (valid for 10 minutes).
   */
  delete: organizationProcedure
    .input(
      z.object({
        quoteId: z.uuid(),
        ids: z.array(z.uuid()).min(1).max(LINE_ITEM_BATCH_MAX),
      })
    )
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        const lines = await findQuoteLines(scope, quote.id, input.ids)
        const ids = lines.map((l) => l.id)
        const snapshot = await snapshotLines(scope, quote, lines)
        await scope.db
          .delete(lineItems)
          .where(scope.where(lineItems, inArray(lineItems.id, ids)))
        const undo = await saveUndoSnapshot(scope, {
          quoteId: quote.id,
          kind: DELETE_UNDO_KIND,
          payload: snapshot,
          userId: cmd.actor.userId,
        })
        return {
          ...(await editorResult(cmd, { deletedLineIds: ids })),
          ...undo,
        }
      })
    ),

  /**
   * Undoes a `lineItem.delete`: re-inserts the deleted lines (same ids,
   * Base Rates, prices and Allocations, from the server-side snapshot) once.
   * Lines whose Phase has gone since come back outside any Phase. Refused
   * (PRECONDITION_FAILED) after the Quote's dates or Time Period changed or
   * once a source was deleted; NOT_FOUND for an unknown or used token.
   */
  restore: organizationProcedure
    .input(z.object({ quoteId: z.uuid(), undoToken: z.uuid() }))
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        const snapshot = await takeUndoSnapshot<LinesSnapshot>(scope, {
          token: input.undoToken,
          quoteId: quote.id,
          kind: DELETE_UNDO_KIND,
        })
        const live = new Set(
          (await quotePhases(scope, quote.id)).map((p) => p.id)
        )
        const restored = await restoreSnapshotLines(
          scope,
          quote,
          snapshot,
          (line) =>
            line.phaseId && live.has(line.phaseId) ? line.phaseId : null
        )
        return editorResult(cmd, { lineIds: restored.map((l) => l.id) })
      })
    ),

  /**
   * Moves Line Items (one or many: a drop or a bulk move is one gesture)
   * into a Phase of the Quote, or outside every Phase (`phaseId: null`),
   * right before `beforeId` (a line staying in that Phase) or at its end.
   * The moved lines keep their grid order relative to each other. Returns
   * every line whose Phase or position changed.
   */
  move: organizationProcedure
    .input(
      z.object({
        quoteId: z.uuid(),
        ids: z.array(z.uuid()).min(1).max(LINE_ITEM_BATCH_MAX),
        phaseId: z.uuid().nullable(),
        beforeId: z.uuid().nullish(),
      })
    )
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        const moving = await findQuoteLines(scope, quote.id, input.ids)
        if (input.phaseId) await assertPhaseOfQuote(cmd, input.phaseId)
        const [phaseRows, lines] = await Promise.all([
          quotePhases(scope, quote.id),
          quoteLineRows(scope, quote.id),
        ])
        const movingIds = new Set(moving.map((l) => l.id))
        const ordered = phaseTreeOrder(phaseRows, lines)
          .filter((row) => row.kind === "line" && movingIds.has(row.id))
          .map((row) => row.id)
        const target = lines
          .filter((l) => l.phaseId === input.phaseId)
          .map((l) => l.id)
        const order = placeBefore(target, ordered, input.beforeId ?? null)
        if (!order) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Drop the lines before a line of the target, or at its end.",
          })
        }
        const byId = new Map(lines.map((l) => [l.id, l]))
        const changed = await resequenceLines(scope, order, byId, input.phaseId)
        return editorResult(cmd, { lineIds: changed })
      })
    ),

  /**
   * Clones Line Items with their Allocations (Base Rates, prices, dates and
   * notes kept). Without `phaseId` each copy goes right after its original;
   * with `phaseId` (a Phase of the Quote, or `null` for none) the copies are
   * appended there instead (duplicate into another Phase). Returns the
   * copies and every line whose position changed.
   */
  clone: organizationProcedure
    .input(
      z.object({
        quoteId: z.uuid(),
        ids: z.array(z.uuid()).min(1).max(LINE_ITEM_BATCH_MAX),
        phaseId: z.uuid().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        const originals = await findQuoteLines(scope, quote.id, input.ids)
        if (input.phaseId) await assertPhaseOfQuote(cmd, input.phaseId)
        const [phaseRows, lines] = await Promise.all([
          quotePhases(scope, quote.id),
          quoteLineRows(scope, quote.id),
        ])
        const treeIndex = new Map(
          phaseTreeOrder(phaseRows, lines).map((row, i) => [row.id, i])
        )
        const sources = [...originals].sort(
          (a, b) => treeIndex.get(a.id)! - treeIndex.get(b.id)!
        )

        if (input.phaseId !== undefined) {
          const target = input.phaseId
          const next =
            Math.max(
              -1,
              ...lines
                .filter((l) => l.phaseId === target)
                .map((l) => l.sequence)
            ) + 1
          const copies = await copyLines(scope, sources, (line) => ({
            phaseId: target,
            sequence: next + sources.indexOf(line),
          }))
          return editorResult(cmd, { lineIds: copies.map((l) => l.id) })
        }

        // In place: each copy right after its original, per container.
        const copies = await copyLines(scope, sources, (line) => ({
          phaseId: line.phaseId,
          sequence: line.sequence,
        }))
        const copyOf = new Map(sources.map((s, i) => [s.id, copies[i]!]))
        const byId = new Map(
          [...lines, ...copies].map((l) => [l.id, l] as const)
        )
        const changed = new Set<string>(copies.map((c) => c.id))
        for (const container of new Set(sources.map((s) => s.phaseId))) {
          const order = lines
            .filter((l) => l.phaseId === container)
            .flatMap((l) => {
              const copy = copyOf.get(l.id)
              return copy ? [l.id, copy.id] : [l.id]
            })
          for (const id of await resequenceLines(
            scope,
            order,
            byId,
            container
          )) {
            changed.add(id)
          }
        }
        return editorResult(cmd, { lineIds: [...changed] })
      })
    ),
})

/**
 * Puts the lines `order` (ids, in their new order) into `phaseId` with
 * sequences 0…n−1, writing only those whose Phase or sequence changed.
 * Returns the changed ids.
 */
async function resequenceLines(
  scope: OrganizationScope,
  order: readonly string[],
  current: ReadonlyMap<string, LineItemRow>,
  phaseId: string | null
): Promise<string[]> {
  const changed: string[] = []
  for (const [sequence, id] of order.entries()) {
    const line = current.get(id)!
    if (line.sequence === sequence && line.phaseId === phaseId) continue
    await scope.update(lineItems, id, { phaseId, sequence })
    changed.push(id)
  }
  return changed
}
