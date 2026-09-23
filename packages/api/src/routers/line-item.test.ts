import { describe, expect, it } from "vitest"

import { asc, eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import type { QuoteStatus } from "@workspace/domain/enums"
import { LOCKED_STATUSES } from "@workspace/domain/status"

import {
  createCatalogItem,
  createMember,
  createOrganization,
  createQuote,
  createResourceRole,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"
import type { TestCaller } from "../test"

const {
  allocations,
  catalogItems,
  lineItems,
  organizationSettings,
  phases,
  quotes,
  resourceRoles,
} = schema

/**
 * An Organization with a member per Role, a Draft Quote owned by the
 * Member (Oct–Dec 2026, Months, USD), a Product (100 / 60), an hourly
 * Add-on (80 / 50 an hour) and a Resource Role (150 / 100 an hour).
 */
async function setup(db: Db, quoteOverrides: { currencyCode?: string } = {}) {
  const organization = await createOrganization(db)
  const members = {
    admin: await createMember(db, organization, { role: "admin" }),
    manager: await createMember(db, organization, { role: "manager" }),
    member: await createMember(db, organization, { role: "member" }),
    otherMember: await createMember(db, organization, { role: "member" }),
    otherManager: await createMember(db, organization, { role: "manager" }),
  }
  const caller = (who: keyof typeof members) =>
    organizationCaller(db, { organization, user: members[who].user })
  const quote = await createQuote(db, organization, {
    owner: members.member.user,
    ...quoteOverrides,
  })
  const product = await createCatalogItem(db, organization, {
    kind: "product",
    name: "Gateway",
    description: "Edge device",
    price: "100",
    cost: "60",
  })
  const addOn = await createCatalogItem(db, organization, {
    kind: "add_on",
    name: "Training",
    price: "80",
    cost: "50",
    billingUnit: "hour",
  })
  const role = await createResourceRole(db, organization, {
    name: "Architect",
    billRate: "150",
    costRate: "100",
  })
  return { organization, members, caller, quote, product, addOn, role }
}

const quoteRow = async (db: Db, id: string) =>
  (await db.select().from(quotes).where(eq(quotes.id, id)))[0]!

const quoteLines = (db: Db, quoteId: string) =>
  db
    .select()
    .from(lineItems)
    .where(eq(lineItems.quoteId, quoteId))
    .orderBy(asc(lineItems.sequence))

/** Adds one Product line through the API and returns it. */
async function addProduct(
  caller: TestCaller,
  quoteId: string,
  productId: string
) {
  const result = await caller.lineItem.add({
    quoteId,
    items: [{ sourceKind: "product", id: productId }],
  })
  return result.lines[0]!
}

describe("lineItem.add", () => {
  it("snapshots Base Rates, defaults quantity and dates, and returns recomputed totals", () =>
    withTestDb(async (db) => {
      const { caller, quote, product, addOn, role, members } = await setup(db)
      const result = await caller("member").lineItem.add({
        quoteId: quote.id,
        items: [
          { sourceKind: "product", id: product.id },
          { sourceKind: "add_on", id: addOn.id },
          { sourceKind: "resource_role", id: role.id },
        ],
      })
      expect(result.deletedLineIds).toEqual([])
      expect(result.lines.map((l) => l.name)).toEqual([
        "Gateway",
        "Training",
        "Architect",
      ])
      expect(result.lines[0]).toMatchObject({
        quoteId: quote.id,
        phaseId: null,
        sourceKind: "product",
        catalogItemId: product.id,
        resourceRoleId: null,
        description: "Edge device",
        notes: null,
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        billingUnit: "each",
        basePrice: "100.0000",
        baseCost: "60.0000",
        unitPrice: "100.0000",
        unitCost: "60.0000",
        quantity: "1.000",
        lineTotal: "100.0000",
        lineMarginPct: "40.0000",
        plannerManaged: false,
      })
      // Hourly lines start at one Time Period (a month = 20 × 8 h).
      expect(result.lines[1]).toMatchObject({
        billingUnit: "hour",
        quantity: "160.000",
        lineTotal: "12800.0000",
      })
      expect(result.lines[2]).toMatchObject({
        sourceKind: "resource_role",
        resourceRoleId: role.id,
        catalogItemId: null,
        billingUnit: "hour",
        basePrice: "150.0000",
        baseCost: "100.0000",
        quantity: "160.000",
        lineTotal: "24000.0000",
      })
      const sequences = result.lines.map((l) => l.sequence)
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b))
      expect(result.totals).toMatchObject({
        subtotal: "36900.0000",
        discountAmount: "0.0000",
        total: "36900.0000",
        cost: "24060.0000",
        margin: "12840.0000",
        marginPct: "34.7967",
        updatedById: members.member.user.id,
      })
      expect(await quoteRow(db, quote.id)).toMatchObject({
        subtotal: "36900.0000",
        total: "36900.0000",
        cost: "24060.0000",
        margin: "12840.0000",
      })
    }))

  it("uses the Organization's Hours Per Day and the Quote's Time Period", () =>
    withTestDb(async (db) => {
      const { organization, members, caller, role } = await setup(db)
      await db
        .insert(organizationSettings)
        .values({ organizationId: organization.id, hoursPerDay: "7.50" })
      const weekly = await createQuote(db, organization, {
        owner: members.member.user,
        timePeriod: "weeks",
      })
      const result = await caller("member").lineItem.add({
        quoteId: weekly.id,
        items: [{ sourceKind: "resource_role", id: role.id }],
      })
      // A week is 5 × 7.5 h.
      expect(result.lines[0]!.quantity).toBe("37.500")
    }))

  it("appends after existing lines and adds the same source twice", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db)
      const first = await addProduct(caller("member"), quote.id, product.id)
      const second = await caller("member").lineItem.add({
        quoteId: quote.id,
        items: [
          { sourceKind: "product", id: product.id },
          { sourceKind: "product", id: product.id },
        ],
      })
      expect(second.lines).toHaveLength(2)
      expect(second.lines[0]!.sequence).toBeGreaterThan(first.sequence)
      expect(second.totals.subtotal).toBe("300.0000")
    }))

  it("adds into a Phase of the Quote, and refuses another Quote's Phase", () =>
    withTestDb(async (db) => {
      const { organization, members, caller, quote, product } = await setup(db)
      const [phase] = await db
        .insert(phases)
        .values({ organizationId: organization.id, quoteId: quote.id, name: "Build" })
        .returning()
      const result = await caller("member").lineItem.add({
        quoteId: quote.id,
        phaseId: phase!.id,
        items: [{ sourceKind: "product", id: product.id }],
      })
      expect(result.lines[0]!.phaseId).toBe(phase!.id)

      const other = await createQuote(db, organization, {
        owner: members.member.user,
      })
      await expect(
        caller("member").lineItem.add({
          quoteId: other.id,
          phaseId: phase!.id,
          items: [{ sourceKind: "product", id: product.id }],
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("refuses inactive sources, wrong kinds and unknown ids, adding nothing", () =>
    withTestDb(async (db) => {
      const { organization, caller, quote, product, addOn } = await setup(db)
      const retired = await createCatalogItem(db, organization, {
        name: "Retired",
        active: false,
      })
      await expect(
        caller("member").lineItem.add({
          quoteId: quote.id,
          items: [
            { sourceKind: "product", id: product.id },
            { sourceKind: "product", id: retired.id },
          ],
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      await expect(
        caller("member").lineItem.add({
          quoteId: quote.id,
          items: [{ sourceKind: "product", id: addOn.id }],
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(
        caller("member").lineItem.add({
          quoteId: quote.id,
          items: [{ sourceKind: "resource_role", id: product.id }],
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      expect(await quoteLines(db, quote.id)).toEqual([])
    }))

  it("can't add another Organization's items to your own Quote", () =>
    withTestDb(async (db) => {
      const { product, role } = await setup(db)
      const outsider = await createOrganization(db)
      const { user } = await createMember(db, outsider, { role: "admin" })
      const own = await createQuote(db, outsider, { owner: user })
      const caller = organizationCaller(db, { organization: outsider, user })
      await expect(
        caller.lineItem.add({
          quoteId: own.id,
          items: [{ sourceKind: "product", id: product.id }],
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(
        caller.lineItem.add({
          quoteId: own.id,
          items: [{ sourceKind: "resource_role", id: role.id }],
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("keeps the Base Rate when the catalog price changes later", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db)
      const line = await addProduct(caller("member"), quote.id, product.id)
      await caller("admin").catalogItem.update({
        id: product.id,
        price: "999",
        cost: "1",
      })
      const editor = await caller("member").quote.editor({ id: quote.id })
      expect(editor.lines.find((l) => l.id === line.id)).toMatchObject({
        basePrice: "100.0000",
        baseCost: "60.0000",
        unitPrice: "100.0000",
        lineTotal: "100.0000",
      })
      expect(editor.totals.total).toBe("100.0000")
    }))
})

describe("pricing and rounding", () => {
  it("rounds each line to the minor unit and sums the rounded lines", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db)
      const a = await addProduct(caller("member"), quote.id, product.id)
      const b = await addProduct(caller("member"), quote.id, product.id)
      await caller("member").lineItem.update({
        quoteId: quote.id,
        id: a.id,
        unitPrice: "0.3333",
        quantity: "3",
      })
      const result = await caller("member").lineItem.update({
        quoteId: quote.id,
        id: b.id,
        unitPrice: "0.3335",
        quantity: "1",
      })
      const lines = await quoteLines(db, quote.id)
      // 0.9999 → 1.00 and 0.3335 → 0.33 (half-up at the cent).
      expect(lines.map((l) => l.lineTotal)).toEqual(["1.0000", "0.3300"])
      expect(result.totals.subtotal).toBe("1.3300")
      expect(result.lines[0]!.lineTotal).toBe("0.3300")
    }))

  it("rounds to whole units in a zero-decimal currency", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db, {
        currencyCode: "JPY",
      })
      const line = await addProduct(caller("member"), quote.id, product.id)
      const result = await caller("member").lineItem.update({
        quoteId: quote.id,
        id: line.id,
        unitPrice: "100.5",
      })
      expect(result.lines[0]!.lineTotal).toBe("101.0000")
      expect(result.totals.total).toBe("101.0000")
    }))

  it("ignores totals a client sends", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db)
      const line = await addProduct(caller("member"), quote.id, product.id)
      const result = await caller("member").lineItem.update({
        quoteId: quote.id,
        id: line.id,
        quantity: "2",
        // Not part of the input: stripped by validation.
        ...({ lineTotal: "1", total: "1" } as object),
      })
      expect(result.lines[0]!.lineTotal).toBe("200.0000")
      expect(result.totals.total).toBe("200.0000")
    }))
})

describe("quote.setDiscount", () => {
  it("keeps a percent discount authoritative as lines change", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db)
      await addProduct(caller("member"), quote.id, product.id)
      const set = await caller("member").quote.setDiscount({
        id: quote.id,
        discount: { kind: "percent", value: "12.5" },
      })
      expect(set.totals).toMatchObject({
        discountKind: "percent",
        discountValue: "12.5000",
        subtotal: "100.0000",
        discountAmount: "12.5000",
        total: "87.5000",
        margin: "27.5000",
      })
      const added = await caller("member").lineItem.add({
        quoteId: quote.id,
        items: [{ sourceKind: "product", id: product.id }],
      })
      expect(added.totals).toMatchObject({
        subtotal: "200.0000",
        discountAmount: "25.0000",
        total: "175.0000",
      })
    }))

  it("keeps an amount discount fixed as lines change, and floors Total at 0", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db)
      const line = await addProduct(caller("member"), quote.id, product.id)
      await caller("member").lineItem.update({
        quoteId: quote.id,
        id: line.id,
        quantity: "3",
      })
      const set = await caller("member").quote.setDiscount({
        id: quote.id,
        discount: { kind: "amount", value: "50" },
      })
      expect(set.totals).toMatchObject({
        discountKind: "amount",
        subtotal: "300.0000",
        discountAmount: "50.0000",
        total: "250.0000",
      })
      const shrunk = await caller("member").lineItem.update({
        quoteId: quote.id,
        id: line.id,
        quantity: "0.25",
      })
      expect(shrunk.totals).toMatchObject({
        subtotal: "25.0000",
        discountAmount: "25.0000",
        total: "0.0000",
        marginPct: "0.0000",
      })
      const cleared = await caller("member").quote.setDiscount({
        id: quote.id,
        discount: null,
      })
      expect(cleared.totals).toMatchObject({
        discountKind: null,
        discountValue: null,
        discountAmount: "0.0000",
        total: "25.0000",
      })
    }))

  it("validates the value", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      for (const discount of [
        { kind: "percent" as const, value: "100.01" },
        { kind: "percent" as const, value: "-1" },
        { kind: "amount" as const, value: "1.23456" },
      ]) {
        await expect(
          caller("member").quote.setDiscount({ id: quote.id, discount })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
    }))
})

describe("lineItem.update", () => {
  it("writes only the given fields", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db)
      const line = await addProduct(caller("member"), quote.id, product.id)
      await caller("member").lineItem.update({
        quoteId: quote.id,
        id: line.id,
        notes: "Ship to HQ",
      })
      const result = await caller("member").lineItem.update({
        quoteId: quote.id,
        id: line.id,
        name: "  Gateway Pro  ",
      })
      expect(result.lines[0]).toMatchObject({
        name: "Gateway Pro",
        notes: "Ship to HQ",
        description: "Edge device",
        quantity: "1.000",
      })
      const cleared = await caller("member").lineItem.update({
        quoteId: quote.id,
        id: line.id,
        notes: "  ",
      })
      expect(cleared.lines[0]!.notes).toBeNull()
    }))

  it("overrides the unit price and resets it to the Base Rate", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db)
      const line = await addProduct(caller("member"), quote.id, product.id)
      const overridden = await caller("member").lineItem.update({
        quoteId: quote.id,
        id: line.id,
        unitPrice: "90",
      })
      expect(overridden.lines[0]).toMatchObject({
        basePrice: "100.0000",
        unitPrice: "90.0000",
        lineTotal: "90.0000",
        lineMarginPct: "33.3333",
      })
      const reset = await caller("member").lineItem.update({
        quoteId: quote.id,
        id: line.id,
        unitPrice: null,
      })
      expect(reset.lines[0]).toMatchObject({
        unitPrice: "100.0000",
        lineTotal: "100.0000",
      })
    }))

  it("keeps dates within the Quote dates", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db)
      const line = await addProduct(caller("member"), quote.id, product.id)
      const ok = await caller("member").lineItem.update({
        quoteId: quote.id,
        id: line.id,
        startDate: "2026-11-01",
        endDate: "2026-11-30",
      })
      expect(ok.lines[0]).toMatchObject({
        startDate: "2026-11-01",
        endDate: "2026-11-30",
      })
      for (const dates of [
        { startDate: "2026-09-30" },
        { endDate: "2027-01-01" },
        { startDate: "2026-12-01" }, // after the line's end
        { endDate: "2026-10-31" }, // before the line's start
      ]) {
        await expect(
          caller("member").lineItem.update({
            quoteId: quote.id,
            id: line.id,
            ...dates,
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
      await expect(
        caller("member").lineItem.update({
          quoteId: quote.id,
          id: line.id,
          startDate: "2026-13-01",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))

  it("validates quantity and name", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db)
      const line = await addProduct(caller("member"), quote.id, product.id)
      for (const patch of [
        { quantity: "-1" },
        { quantity: "1.2345" },
        { name: "   " },
        { unitPrice: "-5" },
      ]) {
        await expect(
          caller("member").lineItem.update({
            quoteId: quote.id,
            id: line.id,
            ...patch,
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
    }))

  it("is NOT_FOUND for another Quote's line", () =>
    withTestDb(async (db) => {
      const { organization, members, caller, quote, product } = await setup(db)
      const line = await addProduct(caller("member"), quote.id, product.id)
      const other = await createQuote(db, organization, {
        owner: members.member.user,
      })
      await expect(
        caller("member").lineItem.update({
          quoteId: other.id,
          id: line.id,
          name: "Moved",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("resizes a planner-managed line's Allocations and refuses end-date edits", () =>
    withTestDb(async (db) => {
      const { organization, caller, quote, role } = await setup(db)
      const added = await caller("member").lineItem.add({
        quoteId: quote.id,
        items: [{ sourceKind: "resource_role", id: role.id }],
      })
      const line = added.lines[0]!
      await db.insert(allocations).values(
        ["2026-10-01", "2026-11-01"].map((periodStart) => ({
          organizationId: organization.id,
          lineItemId: line.id,
          periodType: "month" as const,
          periodStart,
          amount: "80",
        }))
      )
      await db
        .update(lineItems)
        .set({ quantity: "160" })
        .where(eq(lineItems.id, line.id))

      const shrunk = await caller("member").lineItem.update({
        quoteId: quote.id,
        id: line.id,
        quantity: "100",
      })
      expect(shrunk.lines[0]).toMatchObject({
        plannerManaged: true,
        quantity: "100.000",
        lineTotal: "15000.0000",
      })
      const cells = await db
        .select()
        .from(allocations)
        .where(eq(allocations.lineItemId, line.id))
        .orderBy(asc(allocations.periodStart))
      expect(cells.map((c) => [c.periodStart, c.amount])).toEqual([
        ["2026-10-01", "80.000"],
        ["2026-11-01", "20.000"],
      ])

      await expect(
        caller("member").lineItem.update({
          quoteId: quote.id,
          id: line.id,
          endDate: "2026-12-15",
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      await expect(
        caller("member").lineItem.update({
          quoteId: quote.id,
          id: line.id,
          quantity: "100000",
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    }))
})

describe("lineItem.delete / restore", () => {
  it("deletes lines in one command and restores them with undo", () =>
    withTestDb(async (db) => {
      const { organization, caller, quote, product, role } = await setup(db)
      const added = await caller("member").lineItem.add({
        quoteId: quote.id,
        items: [
          { sourceKind: "product", id: product.id },
          { sourceKind: "resource_role", id: role.id },
          { sourceKind: "product", id: product.id },
        ],
      })
      const [keep, roleLine, other] = added.lines
      await caller("member").lineItem.update({
        quoteId: quote.id,
        id: other!.id,
        unitPrice: "75",
        notes: "Discounted",
      })
      await db.insert(allocations).values({
        organizationId: organization.id,
        lineItemId: roleLine!.id,
        periodType: "month",
        periodStart: "2026-10-01",
        amount: "160",
      })
      const before = await quoteLines(db, quote.id)

      const deleted = await caller("member").lineItem.delete({
        quoteId: quote.id,
        ids: [roleLine!.id, other!.id],
      })
      expect(deleted.deletedLineIds.sort()).toEqual(
        [roleLine!.id, other!.id].sort()
      )
      expect(deleted.lines).toEqual([])
      expect(deleted.totals.subtotal).toBe("100.0000")
      expect(deleted.undoToken).toEqual(expect.any(String))
      expect((await quoteLines(db, quote.id)).map((l) => l.id)).toEqual([
        keep!.id,
      ])
      expect(
        await db
          .select()
          .from(allocations)
          .where(eq(allocations.lineItemId, roleLine!.id))
      ).toEqual([])

      const restored = await caller("member").lineItem.restore({
        quoteId: quote.id,
        undoToken: deleted.undoToken,
      })
      expect(restored.lines.map((l) => l.id).sort()).toEqual(
        [roleLine!.id, other!.id].sort()
      )
      expect(restored.totals.subtotal).toBe("24175.0000")
      const after = await quoteLines(db, quote.id)
      const comparable = (rows: typeof before) =>
        rows.map((l) => ({ ...l, createdAt: null, updatedAt: null }))
      expect(comparable(after)).toEqual(comparable(before))
      expect(
        await db
          .select({ amount: allocations.amount })
          .from(allocations)
          .where(eq(allocations.lineItemId, roleLine!.id))
      ).toEqual([{ amount: "160.000" }])

      // An undo works once.
      await expect(
        caller("member").lineItem.restore({
          quoteId: quote.id,
          undoToken: deleted.undoToken,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("refuses ids that aren't all lines of the Quote", () =>
    withTestDb(async (db) => {
      const { organization, members, caller, quote, product } = await setup(db)
      const line = await addProduct(caller("member"), quote.id, product.id)
      const other = await createQuote(db, organization, {
        owner: members.member.user,
      })
      const foreign = await addProduct(caller("member"), other.id, product.id)
      await expect(
        caller("member").lineItem.delete({
          quoteId: quote.id,
          ids: [line.id, foreign.id],
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      expect(await quoteLines(db, quote.id)).toHaveLength(1)
    }))

  it("won't restore onto another Quote or after the Quote dates changed", () =>
    withTestDb(async (db) => {
      const { organization, members, caller, quote, product } = await setup(db)
      const line = await addProduct(caller("member"), quote.id, product.id)
      const deleted = await caller("member").lineItem.delete({
        quoteId: quote.id,
        ids: [line.id],
      })
      const other = await createQuote(db, organization, {
        owner: members.member.user,
      })
      await expect(
        caller("member").lineItem.restore({
          quoteId: other.id,
          undoToken: deleted.undoToken,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })

      await db
        .update(quotes)
        .set({ endDate: "2027-01-31" })
        .where(eq(quotes.id, quote.id))
      await expect(
        caller("member").lineItem.restore({
          quoteId: quote.id,
          undoToken: deleted.undoToken,
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    }))
})

describe("quote.editor", () => {
  it("returns the lines in order with the server's totals", () =>
    withTestDb(async (db) => {
      const { caller, quote, product, role } = await setup(db)
      await caller("member").lineItem.add({
        quoteId: quote.id,
        items: [
          { sourceKind: "resource_role", id: role.id },
          { sourceKind: "product", id: product.id },
        ],
      })
      // Any member may read any Quote.
      const editor = await caller("otherMember").quote.editor({ id: quote.id })
      expect(editor.quoteId).toBe(quote.id)
      expect(editor.phases).toEqual([])
      expect(editor.lines.map((l) => l.name)).toEqual(["Architect", "Gateway"])
      expect(editor.totals).toMatchObject({
        currencyCode: "USD",
        subtotal: "24100.0000",
        total: "24100.0000",
      })
    }))
})

describe("permissions and the lock", () => {
  /** Every editor command against `quoteId`, each as a thunk (run in order). */
  function everyCommand(
    caller: TestCaller,
    quoteId: string,
    ids: { lineId: string; productId: string; undoToken: string }
  ): (() => Promise<unknown>)[] {
    return [
      () =>
        caller.lineItem.add({
          quoteId,
          items: [{ sourceKind: "product", id: ids.productId }],
        }),
      () => caller.lineItem.update({ quoteId, id: ids.lineId, name: "Changed" }),
      () => caller.lineItem.restore({ quoteId, undoToken: ids.undoToken }),
      () => caller.lineItem.delete({ quoteId, ids: [ids.lineId] }),
      () =>
        caller.quote.setDiscount({
          id: quoteId,
          discount: { kind: "percent", value: "5" },
        }),
    ]
  }

  /** A Quote with one line, plus an undo token from deleting a second one. */
  async function withLines(
    caller: TestCaller,
    quoteId: string,
    productId: string
  ) {
    const line = await addProduct(caller, quoteId, productId)
    const gone = await addProduct(caller, quoteId, productId)
    const { undoToken } = await caller.lineItem.delete({
      quoteId,
      ids: [gone.id],
    })
    return { lineId: line.id, productId, undoToken }
  }

  it.each(LOCKED_STATUSES)(
    "refuses every command while %s, even for Admins",
    (status: QuoteStatus) =>
      withTestDb(async (db) => {
        const { caller, quote, product } = await setup(db)
        const ids = await withLines(caller("member"), quote.id, product.id)
        await db
          .update(quotes)
          .set({ status })
          .where(eq(quotes.id, quote.id))
        const before = {
          quote: await quoteRow(db, quote.id),
          lines: await quoteLines(db, quote.id),
        }
        for (const attempt of everyCommand(caller("admin"), quote.id, ids)) {
          await expect(attempt()).rejects.toMatchObject({
            code: "PRECONDITION_FAILED",
          })
        }
        expect({
          quote: await quoteRow(db, quote.id),
          lines: await quoteLines(db, quote.id),
        }).toEqual(before)
      })
  )

  it.each([
    ["otherMember", "FORBIDDEN"],
    ["otherManager", "allowed"],
    ["manager", "allowed"],
    ["admin", "allowed"],
  ] as const)(
    "on a Member's Quote, %s is %s",
    (who, expected) =>
      withTestDb(async (db) => {
        const { caller, quote, product } = await setup(db)
        const ids = await withLines(caller("member"), quote.id, product.id)
        const attempts = everyCommand(caller(who), quote.id, ids)
        if (expected === "FORBIDDEN") {
          for (const attempt of attempts) {
            await expect(attempt()).rejects.toMatchObject({ code: "FORBIDDEN" })
          }
        } else {
          for (const attempt of attempts) {
            await expect(attempt()).resolves.toBeTruthy()
          }
        }
      })
  )

  it("lets a Manager edit only their own Quotes among Managers'", () =>
    withTestDb(async (db) => {
      const { organization, members, caller, product } = await setup(db)
      const managersQuote = await createQuote(db, organization, {
        owner: members.otherManager.user,
      })
      await expect(
        caller("manager").lineItem.add({
          quoteId: managersQuote.id,
          items: [{ sourceKind: "product", id: product.id }],
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
      await expect(
        caller("otherManager").lineItem.add({
          quoteId: managersQuote.id,
          items: [{ sourceKind: "product", id: product.id }],
        })
      ).resolves.toBeTruthy()
    }))
})

describe("sources in use", () => {
  it("refuses to delete a Catalog Item used by Line Items, suggesting deactivate", () =>
    withTestDb(async (db) => {
      const { organization, members, caller, quote, product } = await setup(db)
      const second = await createQuote(db, organization, {
        owner: members.member.user,
        name: "Second",
      })
      await addProduct(caller("member"), quote.id, product.id)
      await addProduct(caller("member"), quote.id, product.id)
      const line = await addProduct(caller("member"), second.id, product.id)
      const error = await caller("admin")
        .catalogItem.delete({ id: product.id })
        .catch((e: unknown) => e)
      expect(error).toMatchObject({ code: "CONFLICT" })
      expect((error as { cause: { details: unknown } }).cause.details).toEqual({
        kind: "in_use",
        entity: "catalog_item",
        name: "Gateway",
        counts: { quotes: 2, lineItems: 3 },
        examples: ["Second", quote.name],
        suggestion: "deactivate",
      })

      // The database backs it (RESTRICT) even without the API check.
      await expect(
        db.transaction((tx) =>
          tx.delete(catalogItems).where(eq(catalogItems.id, product.id))
        )
      ).rejects.toThrow()

      // Once no line uses it, it can go.
      const lines = await quoteLines(db, quote.id)
      await caller("member").lineItem.delete({
        quoteId: quote.id,
        ids: lines.map((l) => l.id),
      })
      await caller("member").lineItem.delete({
        quoteId: second.id,
        ids: [line.id],
      })
      await expect(
        caller("admin").catalogItem.delete({ id: product.id })
      ).resolves.toEqual({ id: product.id })
    }))

  it("refuses to delete a Resource Role used by Line Items", () =>
    withTestDb(async (db) => {
      const { caller, quote, role } = await setup(db)
      await caller("member").lineItem.add({
        quoteId: quote.id,
        items: [{ sourceKind: "resource_role", id: role.id }],
      })
      const error = await caller("admin")
        .resourceRole.delete({ id: role.id })
        .catch((e: unknown) => e)
      expect(error).toMatchObject({ code: "CONFLICT" })
      expect(
        (error as { cause: { details: unknown } }).cause.details
      ).toMatchObject({
        entity: "resource_role",
        counts: { quotes: 1, lineItems: 1 },
        examples: [quote.name],
        suggestion: "deactivate",
      })
      await expect(
        db.transaction((tx) =>
          tx.delete(resourceRoles).where(eq(resourceRoles.id, role.id))
        )
      ).rejects.toThrow()
    }))
})

describe("pickers", () => {
  it("pages active Catalog Items by name with a cursor", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      for (const name of ["Alpha", "bravo", "Charlie", "Delta"]) {
        await createCatalogItem(db, organization, { name, tags: ["kit"] })
      }
      await createCatalogItem(db, organization, {
        name: "Aardvark",
        active: false,
        tags: ["kit"],
      })
      const first = await caller("member").catalogItem.listForPicker({
        kind: "product",
        tags: ["kit"],
        limit: 3,
      })
      expect(first.rows.map((r) => r.name)).toEqual([
        "Alpha",
        "bravo",
        "Charlie",
      ])
      expect(first.nextCursor).toBe(3)
      const second = await caller("member").catalogItem.listForPicker({
        kind: "product",
        tags: ["kit"],
        limit: 3,
        cursor: first.nextCursor,
      })
      expect(second.rows.map((r) => r.name)).toEqual(["Delta"])
      expect(second.nextCursor).toBeNull()
    }))

  it("pages active Resource Roles with filters", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      await createResourceRole(db, organization, {
        name: "Developer",
        locationCountry: "India",
      })
      await createResourceRole(db, organization, {
        name: "Designer",
        locationCountry: "India",
        active: false,
      })
      const page = await caller("member").resourceRole.listForPicker({
        country: "India",
      })
      expect(page.rows.map((r) => r.name)).toEqual(["Developer"])
      expect(page.nextCursor).toBeNull()
    }))

  it("refuses non-members on the Organization's subdomain", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const outsider = await createOrganization(db)
      const { user } = await createMember(db, outsider, { role: "admin" })
      const caller = organizationCaller(db, { organization, user })
      await expect(
        caller.catalogItem.listForPicker({ kind: "product" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(caller.resourceRole.listForPicker({})).rejects.toMatchObject(
        { code: "NOT_FOUND" }
      )
    }))
})

describe("tenancy isolation", () => {
  it.each([
    "lineItem.add",
    "lineItem.update",
    "lineItem.delete",
    "lineItem.restore",
    "quote.setDiscount",
    "quote.editor",
  ] as const)("%s is isolated from other Organizations", (procedure) =>
    withTestDb(async (db) => {
      const { organization, caller, quote, product } = await setup(db)
      const line = await addProduct(caller("member"), quote.id, product.id)
      const gone = await addProduct(caller("member"), quote.id, product.id)
      const { undoToken } = await caller("member").lineItem.delete({
        quoteId: quote.id,
        ids: [gone.id],
      })
      const snapshot = async () => ({
        quote: await quoteRow(db, quote.id),
        lines: await quoteLines(db, quote.id),
      })
      await expectIsolated(db, {
        owner: organization,
        call: (c) => {
          switch (procedure) {
            case "lineItem.add":
              return c.lineItem.add({
                quoteId: quote.id,
                items: [{ sourceKind: "product", id: product.id }],
              })
            case "lineItem.update":
              return c.lineItem.update({
                quoteId: quote.id,
                id: line.id,
                unitPrice: "0",
              })
            case "lineItem.delete":
              return c.lineItem.delete({ quoteId: quote.id, ids: [line.id] })
            case "lineItem.restore":
              return c.lineItem.restore({ quoteId: quote.id, undoToken })
            case "quote.setDiscount":
              return c.quote.setDiscount({
                id: quote.id,
                discount: { kind: "percent", value: "100" },
              })
            case "quote.editor":
              return c.quote.editor({ id: quote.id })
          }
        },
        snapshot,
      })
    })
  )
})
