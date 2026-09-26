/**
 * The Overview and Financials reads, registered on the `quote` router
 * (`quote.overview`, `quote.financials`). Financials computes with the
 * domain's `financials` area over the Quote's stored Line Items (and
 * Allocations); nothing is persisted.
 */
import { z } from "zod"

import { and, asc, eq, schema } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import { periodTypeForTimePeriod } from "@workspace/domain/dates"
import {
  buildFinancials,
  FINANCIAL_GRANULARITIES,
} from "@workspace/domain/financials"

import { notFound } from "../errors"
import { allocationsByLine } from "../line-items"
import { getOrganizationSettings } from "../settings"
import { organizationProcedure } from "../trpc"

const { customers, contacts, lineItems, quotes, resourceRoles } = schema

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

export const quoteOverviewProcedures = {
  /**
   * What the Overview tab adds to `quote.byId` and `quote.editor`: the
   * Customer (industry and billing city for its card) with its primary
   * Contact, and the Resource Roles the Quote's Line Items use (name and
   * location; the tab sums their Effort from the editor's lines, so it
   * follows edits at once). Every member may read it.
   */
  overview: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const quote = await findQuote(ctx.scope, input.id)
      const [customer, [primaryContact], roles] = await Promise.all([
        ctx.scope.findById(customers, quote.customerId),
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
                eq(contacts.customerId, quote.customerId),
                eq(contacts.isPrimary, true)
              )
            )
          )
          .limit(1),
        ctx.scope.db
          .selectDistinct({
            id: resourceRoles.id,
            name: resourceRoles.name,
            locationCity: resourceRoles.locationCity,
            locationState: resourceRoles.locationState,
            locationCountry: resourceRoles.locationCountry,
          })
          .from(lineItems)
          .innerJoin(
            resourceRoles,
            and(
              eq(resourceRoles.organizationId, lineItems.organizationId),
              eq(resourceRoles.id, lineItems.resourceRoleId)
            )
          )
          .where(
            and(
              ctx.scope.where(lineItems, eq(lineItems.quoteId, quote.id)),
              ctx.scope.where(resourceRoles)
            )
          )
          .orderBy(asc(resourceRoles.name)),
      ])
      return {
        quoteId: quote.id,
        customer: {
          id: customer!.id,
          name: customer!.name,
          type: customer!.type,
          industry: customer!.industry,
          website: customer!.website,
          city: customer!.billingCity,
          state: customer!.billingState,
          country: customer!.billingCountry,
        },
        primaryContact: primaryContact ?? null,
        resourceRoles: roles,
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
