/**
 * The Summary and Financials reads, registered on the `quote` router
 * (`quote.summary`, `quote.financials`). Both compute with the domain's
 * `financials` area over the Quote's stored Line Items (and Allocations);
 * nothing is persisted.
 */
import { z } from "zod"

import { and, asc, eq, inArray, schema } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import { periodTypeForTimePeriod } from "@workspace/domain/dates"
import {
  breakdownByItemType,
  buildFinancials,
  FINANCIAL_GRANULARITIES,
} from "@workspace/domain/financials"

import { notFound } from "../errors"
import { allocationsByLine } from "../line-items"
import { getOrganizationSettings } from "../settings"
import { organizationProcedure } from "../trpc"

const { accounts, contacts, lineItems, quotes, users } = schema

async function findQuote(scope: OrganizationScope, id: string) {
  const quote = await scope.findById(quotes, id)
  if (!quote) throw notFound("Quote")
  return quote
}

const quoteLines = (scope: OrganizationScope, quoteId: string) =>
  scope.findMany(lineItems, {
    where: eq(lineItems.quoteId, quoteId),
    orderBy: [asc(lineItems.sequence), asc(lineItems.id)],
  })

export const quoteSummaryProcedures = {
  /**
   * The Summary tab: the Account and its primary Contact, Valid Until, the
   * Owner, the server-computed totals and the item-type breakdown (labour,
   * Products, Add-ons: revenue, cost and own margin before the Quote
   * Discount, share of the Subtotal). Every member may read it.
   */
  summary: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const quote = await findQuote(ctx.scope, input.id)
      const [account, [primaryContact], [owner], lines] = await Promise.all([
        ctx.scope.findById(accounts, quote.accountId),
        ctx.scope.db
          .select({
            id: contacts.id,
            name: contacts.name,
            title: contacts.title,
            email: contacts.email,
            phone: contacts.phone,
          })
          .from(contacts)
          .where(
            ctx.scope.where(
              contacts,
              and(
                eq(contacts.accountId, quote.accountId),
                eq(contacts.isPrimary, true)
              )
            )
          )
          .limit(1),
        ctx.scope.db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, [quote.ownerId])),
        quoteLines(ctx.scope, quote.id),
      ])
      return {
        quoteId: quote.id,
        account: { id: account!.id, name: account!.name },
        primaryContact: primaryContact ?? null,
        validUntil: quote.validUntil,
        owner: owner!,
        startDate: quote.startDate,
        endDate: quote.endDate,
        totals: {
          currencyCode: quote.currencyCode,
          discountKind: quote.discountKind,
          discountValue: quote.discountValue,
          subtotal: quote.subtotal,
          discountAmount: quote.discountAmount,
          total: quote.total,
          cost: quote.cost,
          margin: quote.margin,
          marginPct: quote.marginPct,
        },
        breakdown: breakdownByItemType(lines),
      }
    }),

  /**
   * The Financials tab: revenue (cash inflow, after the Quote Discount
   * spread by revenue), cost, margin, Resource Role hours and headcount
   * (FTE) per month, quarter and year, prorated by calendar-day overlap
   * (Allocations first). All three granularities come at once, so the tab
   * switches without a round trip. Every member may read it.
   */
  financials: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const quote = await findQuote(ctx.scope, input.id)
      const [lines, { hoursPerDay }] = await Promise.all([
        quoteLines(ctx.scope, quote.id),
        getOrganizationSettings(ctx.scope),
      ])
      const byLine = await allocationsByLine(
        ctx.scope,
        lines.map((l) => l.id)
      )
      const financialLines = lines.map((line) => ({
        ...line,
        allocations: byLine.get(line.id) ?? [],
      }))
      const build = (granularity: (typeof FINANCIAL_GRANULARITIES)[number]) =>
        buildFinancials({
          currency: quote.currencyCode,
          granularity,
          quote: { startDate: quote.startDate, endDate: quote.endDate },
          lines: financialLines,
          discountAmount: quote.discountAmount,
          allocationPeriodType: periodTypeForTimePeriod(quote.timePeriod),
          hoursPerDay,
        })
      return {
        quoteId: quote.id,
        currencyCode: quote.currencyCode,
        hoursPerDay,
        month: build("month"),
        quarter: build("quarter"),
        year: build("year"),
      }
    }),
}
