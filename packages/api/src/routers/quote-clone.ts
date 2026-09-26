/**
 * Quote Clone (glossary: Clone), spread into the `quote` router as
 * `quote.clone`.
 *
 * A clone is a new Draft Quote named "Copy of {name}", owned by the cloner,
 * for the source's Customer or another unarchived one. It copies the header
 * (Description, dates, Valid Until, Time Period, currency), the Phase tree
 * (parents remapped), every Line Item with its Allocations, the Milestones
 * (completed reset) and the Quote Discount, then reprices with
 * `recomputeQuoteTotals`.
 *
 * It copies nothing else: every child table that belongs to a Quote's own
 * record (Approval Steps, Quote Documents, cost log entries, undo
 * snapshots) is left behind by construction, because only the tables named
 * above are read. A new Quote-owned table is therefore never cloned unless
 * it is added here on purpose.
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { inArray, recomputeQuoteTotals, schema, uuidv7 } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import { Decimal } from "@workspace/domain/money"
import { QUOTE_NAME_MAX } from "@workspace/domain/quotes"

import { notFound } from "../errors"
import type { LineCopyPlacement } from "../line-items"
import {
  copyLines,
  quoteLineRows,
  quoteMilestones,
  quotePhases,
} from "../line-items"
import { organizationProcedure } from "../trpc"

const { customers, catalogItems, milestones, phases, quotes, resourceRoles } =
  schema

type LineItemRow = typeof schema.lineItems.$inferSelect
type PhaseRow = typeof phases.$inferSelect

/** The clone's Name: "Copy of {name}", cut to the Name limit. */
export const cloneName = (name: string) =>
  `Copy of ${name}`.slice(0, QUOTE_NAME_MAX)

/** `rows` ordered so every Phase comes after its parent. */
function parentsFirst(rows: readonly PhaseRow[]): PhaseRow[] {
  const ordered: PhaseRow[] = []
  const placed = new Set<string>()
  let pending = [...rows]
  while (pending.length > 0) {
    const ready = pending.filter((p) => !p.parentId || placed.has(p.parentId))
    // A parent outside the Quote can't happen (same-Quote FK); stop anyway.
    if (ready.length === 0) break
    for (const p of ready) placed.add(p.id)
    ordered.push(...ready)
    pending = pending.filter((p) => !placed.has(p.id))
  }
  return ordered
}

/**
 * The current price and cost of each line's source, for "refresh prices
 * and costs from the catalog". Inactive sources are left out (and deleted
 * ones can't be found), so those lines keep their snapshot.
 */
async function currentRates(
  scope: OrganizationScope,
  lines: readonly LineItemRow[]
): Promise<Map<string, { price: string; cost: string }>> {
  const catalogIds = [...new Set(lines.flatMap((l) => l.catalogItemId ?? []))]
  const roleIds = [...new Set(lines.flatMap((l) => l.resourceRoleId ?? []))]
  const [items, roles] = await Promise.all([
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
  const rates = new Map<string, { price: string; cost: string }>()
  for (const item of items) {
    if (item.active) rates.set(item.id, { price: item.price, cost: item.cost })
  }
  for (const role of roles) {
    if (role.active) {
      rates.set(role.id, { price: role.billRate, cost: role.costRate })
    }
  }
  return rates
}

/**
 * A line's re-snapshotted rates: the source's current price and cost become
 * the Base Rate. The unit price and cost follow it unless they had been
 * overridden (differ from the old Base Rate), in which case the override
 * stays — a negotiated price is kept, the list price under it moves.
 */
function refreshedRates(
  line: LineItemRow,
  rate: { price: string; cost: string }
): Partial<LineCopyPlacement> {
  const follows = (unit: string, base: string) =>
    new Decimal(unit).equals(new Decimal(base))
  return {
    basePrice: rate.price,
    baseCost: rate.cost,
    unitPrice: follows(line.unitPrice, line.basePrice)
      ? rate.price
      : line.unitPrice,
    unitCost: follows(line.unitCost, line.baseCost) ? rate.cost : line.unitCost,
  }
}

export const quoteCloneProcedures = {
  /**
   * Clones a Quote (see the module comment) and returns the new Quote's
   * `{ id, name }`. Any member may clone any Quote they can see — every
   * member sees every Quote, and cloning changes nothing on the source, so
   * a locked or someone else's Quote can be cloned too. `customerId` puts
   * the clone on another Customer (NOT_FOUND if not this Organization's);
   * the target Customer must not be archived (PRECONDITION_FAILED), which
   * includes the source's own when none is given. `refreshRates`
   * re-snapshots every line's Base Rate from its source's current price
   * and cost (`refreshedRates`); lines whose source is inactive or gone
   * keep their snapshot. The currency is the source's (an Organization's
   * currency never changes).
   */
  clone: organizationProcedure
    .input(
      z.object({
        id: z.uuid(),
        customerId: z.uuid().optional(),
        refreshRates: z.boolean().default(false),
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const source = await scope.findById(quotes, input.id)
        if (!source) throw notFound("Quote")
        const customer = await scope.findById(
          customers,
          input.customerId ?? source.customerId
        )
        if (!customer) throw notFound("Customer")
        if (customer.archived) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `“${customer.name}” is archived. Unarchive it or choose another Customer.`,
          })
        }

        const quote = await scope.insert(quotes, {
          customerId: customer.id,
          name: cloneName(source.name),
          description: source.description,
          startDate: source.startDate,
          endDate: source.endDate,
          validUntil: source.validUntil,
          timePeriod: source.timePeriod,
          status: "draft",
          currencyCode: source.currencyCode,
          discountKind: source.discountKind,
          discountValue: source.discountValue,
          ownerId: ctx.user.id,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        })

        const [phaseRows, lineRows, milestoneRows] = await Promise.all([
          quotePhases(scope, source.id),
          quoteLineRows(scope, source.id),
          quoteMilestones(scope, source.id),
        ])

        const phaseId = new Map(phaseRows.map((p) => [p.id, uuidv7()]))
        if (phaseRows.length) {
          await scope.insertMany(
            phases,
            parentsFirst(phaseRows).map((p) => ({
              id: phaseId.get(p.id)!,
              quoteId: quote.id,
              parentId: p.parentId ? phaseId.get(p.parentId)! : null,
              name: p.name,
              sequence: p.sequence,
            }))
          )
        }

        const rates = input.refreshRates
          ? await currentRates(scope, lineRows)
          : new Map<string, { price: string; cost: string }>()
        await copyLines(scope, lineRows, (line) => {
          const rate = rates.get(line.catalogItemId ?? line.resourceRoleId!)
          return {
            quoteId: quote.id,
            phaseId: line.phaseId ? phaseId.get(line.phaseId)! : null,
            sequence: line.sequence,
            ...(rate ? refreshedRates(line, rate) : {}),
          }
        })

        if (milestoneRows.length) {
          await scope.insertMany(
            milestones,
            milestoneRows.map((m) => ({
              quoteId: quote.id,
              name: m.name,
              date: m.date,
              type: m.type,
              colour: m.colour,
              completed: false,
              description: m.description,
            }))
          )
        }

        await recomputeQuoteTotals(scope, quote.id, {
          updatedById: ctx.user.id,
        })
        return { id: quote.id, name: quote.name }
      })
    ),
}
