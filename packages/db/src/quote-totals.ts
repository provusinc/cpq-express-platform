/**
 * Server-side pricing of a Quote (ADR-0002): the one place Line Item totals
 * and Quote totals are computed and persisted.
 *
 *   const { totals, lines } = await recomputeQuoteTotals(scope, quote.id, {
 *     updatedById: actor.userId,
 *   })
 *
 * It reads the Quote's current Line Items (in grid order) and Quote
 * Discount, runs the domain's `priceQuote` in the Quote's currency, writes
 * `line_total` / `line_margin_pct` on the lines whose values changed and
 * the Quote's Subtotal, discount amount, Total, cost, Margin and margin %,
 * and returns the new totals with every line as now stored.
 *
 * Call it inside the command's transaction after changing lines, the
 * discount or anything else that affects money (the API's `quoteCommand`
 * exposes it as `cmd.reprice()`). Nothing sent by a client ever reaches
 * these columns. It lives in `db` (not `api`) so the seed prices demo
 * Quotes with the exact same code.
 */
import { asc, eq } from "drizzle-orm"

import { Decimal } from "@workspace/domain/money"
import { priceQuote } from "@workspace/domain/pricing"

import type { OrganizationScope } from "./organization-scope"
import { lineItems, quotes } from "./schema"
import type { LineItem } from "./schema"

/** A Quote's money as the editor shows it (all strings at storage scale). */
export interface QuoteTotalsRow {
  currencyCode: string
  discountKind: "percent" | "amount" | null
  discountValue: string | null
  subtotal: string
  discountAmount: string
  total: string
  cost: string
  margin: string
  marginPct: string
  updatedAt: Date
  updatedById: string
}

export interface RecomputeResult {
  totals: QuoteTotalsRow
  /** Every Line Item of the Quote, in grid order, with its new total and margin. */
  lines: LineItem[]
}

/** Recomputes and persists a Quote's money; see the module comment. */
export async function recomputeQuoteTotals(
  scope: OrganizationScope,
  quoteId: string,
  { updatedById }: { updatedById: string }
): Promise<RecomputeResult> {
  const quote = await scope.findById(quotes, quoteId)
  if (!quote) throw new Error(`recomputeQuoteTotals: Quote ${quoteId} not found`)
  const lines = await scope.findMany(lineItems, {
    where: eq(lineItems.quoteId, quoteId),
    orderBy: [asc(lineItems.sequence), asc(lineItems.id)],
  })

  const priced = priceQuote({
    currency: quote.currencyCode,
    lines,
    discount:
      quote.discountKind && quote.discountValue !== null
        ? { kind: quote.discountKind, value: quote.discountValue }
        : null,
  })

  const stored = await Promise.all(
    lines.map(async (line, i) => {
      const { lineTotal, lineMarginPct } = priced.lines[i]!
      if (
        new Decimal(line.lineTotal).equals(lineTotal) &&
        new Decimal(line.lineMarginPct).equals(lineMarginPct)
      ) {
        return line
      }
      return (await scope.update(lineItems, line.id, {
        lineTotal,
        lineMarginPct,
      }))!
    })
  )

  const [row] = await scope.db
    .update(quotes)
    .set({
      subtotal: priced.subtotal,
      discountAmount: priced.discountAmount,
      total: priced.total,
      cost: priced.cost,
      margin: priced.margin,
      marginPct: priced.marginPct,
      updatedById,
    })
    .where(scope.where(quotes, eq(quotes.id, quoteId)))
    .returning()
  const updated = row!
  return {
    totals: {
      currencyCode: updated.currencyCode,
      discountKind: updated.discountKind,
      discountValue: updated.discountValue,
      subtotal: updated.subtotal,
      discountAmount: updated.discountAmount,
      total: updated.total,
      cost: updated.cost,
      margin: updated.margin,
      marginPct: updated.marginPct,
      updatedAt: updated.updatedAt,
      updatedById: updated.updatedById,
    },
    lines: stored,
  }
}
