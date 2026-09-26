/**
 * Cost Propagation (glossary): when an Admin changes a Catalog Item's cost
 * or a Resource Role's cost rate, every Line Item on a **Draft** Quote that
 * references it takes the new cost as its Base Rate cost and unit cost, the
 * affected Quotes are repriced (`recomputeQuoteTotals`, so line and Quote
 * margins move) and one cost change log row is written per rewritten line,
 * all in the caller's transaction:
 *
 *   ctx.scope.transaction(async (scope) => {
 *     const item = await scope.update(catalogItems, id, changes)
 *     const costPropagation = await propagateCost(scope, {
 *       source: { kind: item.kind, id: item.id, name: item.name },
 *       cost: item.cost,
 *       actorId: ctx.user.id,
 *     })
 *   })
 *
 * Quotes in any other Stage are never touched (their Base Rates are part of
 * what was submitted or committed), and price changes never propagate
 * (callers only call this for a cost change). Affected Quotes are locked
 * (`FOR UPDATE`, in id order) like every Quote command, so propagation
 * serialises with concurrent edits of those Quotes.
 */
import {
  asc,
  eq,
  inArray,
  ne,
  or,
  recomputeQuoteTotals,
  schema,
} from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import type { SourceKind } from "@workspace/domain/enums"
import { toMoneyString } from "@workspace/domain/money"

const { costChangeLog, lineItems, quotes } = schema

export interface CostPropagationResult {
  /** Draft Quotes whose lines were rewritten (and repriced). */
  quotes: number
  /** Line Items rewritten (one cost change log row each). */
  lineItems: number
}

export async function propagateCost(
  scope: OrganizationScope,
  {
    source,
    cost,
    actorId,
  }: {
    source: { kind: SourceKind; id: string; name: string }
    /** The source's new cost (cost rate for a Resource Role). */
    cost: string
    actorId: string
  }
): Promise<CostPropagationResult> {
  const newCost = toMoneyString(cost)
  const sourceColumn =
    source.kind === "resource_role"
      ? lineItems.resourceRoleId
      : lineItems.catalogItemId
  const differs = or(
    ne(lineItems.baseCost, newCost),
    ne(lineItems.unitCost, newCost)
  )

  // The Draft Quotes with lines to rewrite, locked in a stable order.
  const affected = scope.db
    .selectDistinct({ quoteId: lineItems.quoteId })
    .from(lineItems)
    .where(scope.where(lineItems, eq(sourceColumn, source.id), differs))
  const locked = await scope.db
    .select({ id: quotes.id })
    .from(quotes)
    .where(
      scope.where(
        quotes,
        eq(quotes.stage, "draft"),
        inArray(quotes.id, affected)
      )
    )
    .orderBy(asc(quotes.id))
    .for("update")
  if (locked.length === 0) return { quotes: 0, lineItems: 0 }
  const quoteIds = locked.map((q) => q.id)

  const lines = await scope.db
    .select({
      id: lineItems.id,
      quoteId: lineItems.quoteId,
      baseCost: lineItems.baseCost,
    })
    .from(lineItems)
    .where(
      scope.where(
        lineItems,
        eq(sourceColumn, source.id),
        inArray(lineItems.quoteId, quoteIds),
        differs
      )
    )
    .orderBy(asc(lineItems.quoteId), asc(lineItems.id))

  await scope.db
    .update(lineItems)
    .set({ baseCost: newCost, unitCost: newCost })
    .where(
      scope.where(
        lineItems,
        inArray(
          lineItems.id,
          lines.map((l) => l.id)
        )
      )
    )
  await scope.insertMany(
    costChangeLog,
    lines.map((line) => ({
      quoteId: line.quoteId,
      lineItemId: line.id,
      sourceKind: source.kind,
      sourceId: source.id,
      sourceName: source.name,
      oldCost: line.baseCost,
      newCost,
      actorId,
    }))
  )
  for (const quoteId of quoteIds) {
    await recomputeQuoteTotals(scope, quoteId, { updatedById: actorId })
  }
  return { quotes: quoteIds.length, lineItems: lines.length }
}
