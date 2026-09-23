import { describe, expect, it } from "vitest"

import { schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import { Decimal } from "@workspace/domain/money"

import {
  createAccount,
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
 * A Member's Draft Quote (Oct–Dec 2026, Months) for an Account with a
 * primary Contact, with a Product (100 / 60) on Oct 1–31 and a Resource
 * Role (150 / 100 an hour) over the whole Quote, and a 10 % Quote Discount.
 */
async function setup(db: Db) {
  const organization = await createOrganization(db)
  const { user } = await createMember(db, organization, { role: "member" })
  const caller = organizationCaller(db, { organization, user })
  const account = await createAccount(db, organization, { name: "Initech" })
  await createContact(db, account, { name: "Other", isPrimary: false })
  await createContact(db, account, {
    name: "Peter Gibbons",
    email: "peter@initech.test",
    isPrimary: true,
  })
  const quote = await createQuote(db, organization, {
    owner: user,
    account,
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
  return { organization, user, caller, account, quote, roleLine: roleLine! }
}

const sum = (values: string[]) =>
  values.reduce((a, v) => a.plus(v), new Decimal(0)).toFixed(4)

describe("quote.summary", () => {
  it("returns the Account, primary Contact, Owner, totals and breakdown", () =>
    withTestDb(async (db) => {
      const { caller, quote, user } = await setup(db)
      const summary = await caller.quote.summary({ id: quote.id })
      expect(summary).toMatchObject({
        account: { name: "Initech" },
        primaryContact: { name: "Peter Gibbons", email: "peter@initech.test" },
        validUntil: "2026-11-30",
        owner: { id: user.id },
        totals: {
          // 100 + 160 h × 150 = 24100; 10 % off.
          subtotal: "24100.0000",
          discountAmount: "2410.0000",
          total: "21690.0000",
        },
      })
      expect(
        summary.breakdown.map((b) => [b.sourceKind, b.lineCount, b.revenue])
      ).toEqual([
        ["resource_role", 1, "24000.0000"],
        ["product", 1, "100.0000"],
        ["add_on", 0, "0.0000"],
      ])
    }))

  it("has no primary Contact when the Account has none", () =>
    withTestDb(async (db) => {
      const organization = await createOrganization(db)
      const { user } = await createMember(db, organization)
      const quote = await createQuote(db, organization, { owner: user })
      const summary = await organizationCaller(db, {
        organization,
        user,
      }).quote.summary({ id: quote.id })
      expect(summary.primaryContact).toBeNull()
      expect(summary.breakdown.every((b) => b.lineCount === 0)).toBe(true)
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (c) => c.quote.summary({ id: quote.id }),
      })
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
