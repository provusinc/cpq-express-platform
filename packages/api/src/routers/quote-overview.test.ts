import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import { Decimal } from "@workspace/domain/money"

import {
  createCustomer,
  createCatalogItem,
  createContact,
  createMember,
  createOrganization,
  createQuote,
  createResourceRole,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const { allocations } = schema

/**
 * A Member's Draft Quote (Oct–Dec 2026, Months) for a Customer with a
 * primary Contact, with a Product (100 / 60) on Oct 1–31 and a Resource
 * Role (150 / 100 an hour) over the whole Quote, and a 10 % Quote Discount.
 */
async function setup(db: Db) {
  const organization = await createOrganization(db)
  const { user } = await createMember(db, organization, { role: "member" })
  const caller = organizationCaller(db, { organization, user })
  const customer = await createCustomer(db, organization, { name: "Initech" })
  await createContact(db, customer, { name: "Other", isPrimary: false })
  await createContact(db, customer, {
    name: "Peter Gibbons",
    email: "peter@initech.test",
    isPrimary: true,
  })
  const quote = await createQuote(db, organization, {
    owner: user,
    customer,
    validUntil: "2026-11-30",
  })
  const product = await createCatalogItem(db, organization, {
    kind: "product",
    price: "100",
    cost: "60",
  })
  const role = await createResourceRole(db, organization, {
    billRate: "150",
    costRate: "100",
  })
  const added = await caller.lineItem.add({
    quoteId: quote.id,
    items: [
      { sourceKind: "product", id: product.id },
      { sourceKind: "resource_role", id: role.id },
    ],
  })
  const [productLine, roleLine] = added.lines
  await caller.lineItem.update({
    quoteId: quote.id,
    id: productLine!.id,
    endDate: "2026-10-31",
  })
  await caller.quote.setDiscount({
    id: quote.id,
    discount: { kind: "percent", value: "10" },
  })
  return { organization, user, caller, customer, quote, roleLine: roleLine! }
}

const sum = (values: string[]) =>
  values.reduce((a, v) => a.plus(v), new Decimal(0)).toFixed(4)

describe("quote.overview", () => {
  it("returns the Customer with its primary Contact and the Quote's Resource Roles", () =>
    withTestDb(async (db) => {
      const { caller, quote, organization, customer } = await setup(db)
      // A second line of the same Resource Role lists it once.
      const [role] = await db
        .select()
        .from(schema.resourceRoles)
        .where(eq(schema.resourceRoles.organizationId, organization.id))
      await caller.lineItem.add({
        quoteId: quote.id,
        items: [{ sourceKind: "resource_role", id: role!.id }],
      })
      const overview = await caller.quote.overview({ id: quote.id })
      expect(overview).toMatchObject({
        quoteId: quote.id,
        customer: { id: customer.id, name: "Initech" },
        primaryContact: { name: "Peter Gibbons", email: "peter@initech.test" },
      })
      expect(overview.resourceRoles).toEqual([
        expect.objectContaining({ id: role!.id, name: role!.name }),
      ])
    }))

  it("has no primary Contact or Resource Roles on an empty Quote", () =>
    withTestDb(async (db) => {
      const organization = await createOrganization(db)
      const { user } = await createMember(db, organization)
      const quote = await createQuote(db, organization, { owner: user })
      const overview = await organizationCaller(db, {
        organization,
        user,
      }).quote.overview({ id: quote.id })
      expect(overview.primaryContact).toBeNull()
      expect(overview.resourceRoles).toEqual([])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (c) => c.quote.overview({ id: quote.id }),
      })
    }))
})

describe("quote.byId effortHours", () => {
  it("sums the hourly Line Items' quantity only", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      // The Resource Role line's default: Oct–Dec at 8 h/day by month = 160 h;
      // the Product (each) doesn't count.
      const byId = await caller.quote.byId({ id: quote.id })
      expect(byId.effortHours).toBe("160.000")
    }))
})

describe("quote.financials", () => {
  it("buckets revenue after the discount, cost and headcount; sums match the Quote", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const financials = await caller.quote.financials({ id: quote.id })
      const byId = await caller.quote.byId({ id: quote.id })
      for (const granularity of ["month", "quarter", "year"] as const) {
        const { buckets, totals } = financials[granularity]
        expect(sum(buckets.map((b) => b.revenue))).toBe(byId.total)
        expect(sum(buckets.map((b) => b.discount))).toBe(byId.discountAmount)
        expect(totals.revenue).toBe(byId.total)
        expect(totals.cost).toBe(byId.cost)
      }
      expect(financials.month.buckets.map((b) => b.label)).toEqual([
        "Oct 2026",
        "Nov 2026",
        "Dec 2026",
      ])
      expect(financials.quarter.buckets.map((b) => b.label)).toEqual([
        "Q4 2026",
      ])
      // The Product (Oct only) makes October's gross revenue the largest.
      const [oct, nov] = financials.month.buckets
      expect(new Decimal(oct!.grossRevenue).gt(nov!.grossRevenue)).toBe(true)
      expect(sum(financials.month.buckets.map((b) => b.hours))).toBe("160.0000")
    }))

  it("follows the Resource Planner's Allocations", () =>
    withTestDb(async (db) => {
      const { organization, caller, quote, roleLine } = await setup(db)
      await db.insert(allocations).values([
        {
          organizationId: organization.id,
          lineItemId: roleLine.id,
          periodType: "month",
          periodStart: "2026-12-01",
          amount: "160",
        },
      ])
      const { month } = await caller.quote.financials({ id: quote.id })
      expect(month.buckets.map((b) => b.hours)).toEqual([
        "0.000",
        "0.000",
        "160.000",
      ])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (c) => c.quote.financials({ id: quote.id }),
      })
    }))
})
