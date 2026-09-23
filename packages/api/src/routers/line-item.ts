import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { and, eq, inArray, schema } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import { resizeAllocatedEffort } from "@workspace/domain/allocations"
import type { AllocationInput } from "@workspace/domain/allocations"
import { compareDates } from "@workspace/domain/dates"
import type { IsoDate } from "@workspace/domain/dates"
import { SOURCE_KINDS } from "@workspace/domain/enums"
import type { TimePeriod } from "@workspace/domain/enums"
import { defaultLineItemQuantity } from "@workspace/domain/pricing"
import { changeLineItemStart } from "@workspace/domain/schedule"

import { writeAllocations } from "../allocations"
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
  editorResult,
  findQuoteLines,
  nextLineSequence,
  omit,
  saveUndoSnapshot,
  takeUndoSnapshot,
} from "../line-items"
import type { QuoteCommand } from "../quotes"
import { quoteCommand } from "../quotes"
import { getOrganizationSettings } from "../settings"
import { createTRPCRouter, organizationProcedure } from "../trpc"

const { allocations, catalogItems, lineItems, phases, resourceRoles } = schema

type LineItemRow = typeof lineItems.$inferSelect
type AllocationRow = typeof allocations.$inferSelect

/** The most sources one Add Items gesture may add, and lines one delete may remove. */
export const LINE_ITEM_BATCH_MAX = 200

const NAME_MAX = 200
const TEXT_MAX = 2000

/** Undo snapshot kind written by `lineItem.delete`. */
const DELETE_UNDO_KIND = "line_items.delete"

/** What `lineItem.delete` keeps so `lineItem.restore` can put it back. */
interface DeletedLinesSnapshot {
  /** The Quote's window and Time Period at delete time; restore needs them unchanged. */
  quote: { startDate: IsoDate; endDate: IsoDate; timePeriod: TimePeriod }
  lines: Array<Omit<LineItemRow, "createdAt" | "updatedAt">>
  allocations: Array<Omit<AllocationRow, "createdAt" | "updatedAt">>
}

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
 * Organization's item of that kind (NOT_FOUND otherwise) and active
 * (PRECONDITION_FAILED: inactive items stay on Quotes but can't be added).
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
  const [catalog, roles] = await Promise.all([
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
  ])
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
    if (!catalogItem || catalogItem.kind !== item.sourceKind) {
      throw notFound("Catalog Item")
    }
    if (!catalogItem.active) throw inactive(catalogItem.name)
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
        const stored = await scope.findMany(allocations, {
          where: inArray(allocations.lineItemId, ids),
        })
        const snapshot: DeletedLinesSnapshot = {
          quote: {
            startDate: quote.startDate,
            endDate: quote.endDate,
            timePeriod: quote.timePeriod,
          },
          lines: lines.map((l) => omit(l, "createdAt", "updatedAt")),
          allocations: stored.map((a) => omit(a, "createdAt", "updatedAt")),
        }
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
        const snapshot = await takeUndoSnapshot<DeletedLinesSnapshot>(scope, {
          token: input.undoToken,
          quoteId: quote.id,
          kind: DELETE_UNDO_KIND,
        })
        if (
          snapshot.quote.startDate !== quote.startDate ||
          snapshot.quote.endDate !== quote.endDate ||
          snapshot.quote.timePeriod !== quote.timePeriod
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "The Quote's dates or Time Period changed since, so the delete can't be undone.",
          })
        }
        const phaseIds = [
          ...new Set(snapshot.lines.flatMap((l) => l.phaseId ?? [])),
        ]
        const livePhases = phaseIds.length
          ? await scope.findMany(phases, {
              where: and(
                eq(phases.quoteId, quote.id),
                inArray(phases.id, phaseIds)
              ),
            })
          : []
        const live = new Set(livePhases.map((p) => p.id))
        const catalogIds = snapshot.lines.flatMap((l) => l.catalogItemId ?? [])
        const roleIds = snapshot.lines.flatMap((l) => l.resourceRoleId ?? [])
        const [catalog, roles] = await Promise.all([
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
        ])
        if (
          catalog.length !== new Set(catalogIds).size ||
          roles.length !== new Set(roleIds).size
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "An item on these lines was deleted since, so the delete can't be undone.",
          })
        }
        const restored = await scope.insertMany(
          lineItems,
          snapshot.lines.map((line) => ({
            ...omit(line, "organizationId"),
            phaseId: line.phaseId && live.has(line.phaseId) ? line.phaseId : null,
          }))
        )
        await scope.insertMany(
          allocations,
          snapshot.allocations.map((a) => omit(a, "organizationId"))
        )
        return editorResult(cmd, { lineIds: restored.map((l) => l.id) })
      })
    ),
})
