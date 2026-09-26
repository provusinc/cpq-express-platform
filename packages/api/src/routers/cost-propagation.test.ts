import { describe, expect, it } from "vitest"

import { asc, eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import type { QuoteStage } from "@workspace/domain/enums"
import { Decimal } from "@workspace/domain/money"

import {
  createCatalogItem,
  createMember,
  createOrganization,
  createQuote,
  createResourceRole,
  expectIsolated,
  organizationCaller,
  setQuoteStage,
  withTestDb,
} from "../test"

const { costChangeLog, lineItems, quotes } = schema

/**
 * An Organization with an Admin and a Member who owns Quotes, a Product
 * (100 / 60) and a Resource Role (150 / 100 an hour).
 */
async function setup(db: Db) {
  const organization = await createOrganization(db)
  const admin = await createMember(db, organization, { role: "admin" })
  const member = await createMember(db, organization, { role: "member" })
  const as = (who: typeof admin) =>
    organizationCaller(db, { organization, user: who.user })
  const product = await createCatalogItem(db, organization, {
    type: "Product",
    name: "Gateway",
    price: "100",
    cost: "60",
  })
  const role = await createResourceRole(db, organization, {
    name: "Architect",
    billRate: "150",
    costRate: "100",
  })
  /** A Quote of the Member's with one Gateway (qty 1) and one Architect line, then set to `stage`. */
  const quoteWithLines = async (stage: QuoteStage = "draft", name?: string) => {
    const quote = await createQuote(db, organization, {
      owner: member.user,
      ...(name ? { name } : {}),
    })
    await as(member).lineItem.add({
      quoteId: quote.id,
      items: [
        { sourceKind: "catalog_item", id: product.id },
        { sourceKind: "resource_role", id: role.id },
      ],
    })
    if (stage !== "draft") await setQuoteStage(db, quote, stage)
    return quote
  }
  return {
    organization,
    admin,
    member,
    as,
    product,
    role,
    quoteWithLines,
  }
}

const quoteRow = async (db: Db, id: string) =>
  (await db.select().from(quotes).where(eq(quotes.id, id)))[0]!

const linesOf = (db: Db, quoteId: string) =>
  db
    .select()
    .from(lineItems)
    .where(eq(lineItems.quoteId, quoteId))
    .orderBy(asc(lineItems.sequence))

const logOf = (db: Db, quoteId: string) =>
  db.select().from(costChangeLog).where(eq(costChangeLog.quoteId, quoteId))

describe("Cost Propagation from a Catalog Item", () => {
  it("rewrites Draft lines' Base Rate and unit cost, reprices and logs each line", () =>
    withTestDb(async (db) => {
      const { admin, as, product, quoteWithLines } = await setup(db)
      const draft = await quoteWithLines()
      const before = await quoteRow(db, draft.id)
      const [gateway, architect] = await linesOf(db, draft.id)

      const result = await as(admin).catalogItem.update({
        id: product.id,
        cost: "80",
      })
      expect(result).toMatchObject({
        cost: "80.0000",
        costPropagation: { quotes: 1, lineItems: 1 },
      })

      const [gatewayAfter, architectAfter] = await linesOf(db, draft.id)
      expect(gatewayAfter).toMatchObject({
        baseCost: "80.0000",
        unitCost: "80.0000",
        basePrice: gateway!.basePrice,
        unitPrice: gateway!.unitPrice,
        lineMarginPct: "20.0000",
      })
      expect(architectAfter).toEqual(architect)

      const after = await quoteRow(db, draft.id)
      expect(after.total).toBe(before.total)
      // 60 → 80 on one Gateway.
      expect(new Decimal(after.cost).minus(before.cost).toFixed(4)).toBe(
        "20.0000"
      )
      expect(after.updatedById).toBe(admin.user.id)

      expect(await logOf(db, draft.id)).toMatchObject([
        {
          lineItemId: gateway!.id,
          sourceKind: "catalog_item",
          sourceId: product.id,
          sourceName: "Gateway",
          oldCost: "60.0000",
          newCost: "80.0000",
          actorId: admin.user.id,
        },
      ])
    }))

  it.each(["in_approval", "approved", "with_customer", "won", "lost"] as const)(
    "leaves %s Quotes untouched",
    (stage) =>
      withTestDb(async (db) => {
        const { admin, as, product, quoteWithLines } = await setup(db)
        const draft = await quoteWithLines("draft", "Draft one")
        const other = await quoteWithLines(stage, "Other")
        const before = {
          quote: await quoteRow(db, other.id),
          lines: await linesOf(db, other.id),
        }
        const result = await as(admin).catalogItem.update({
          id: product.id,
          cost: "10",
        })
        expect(result.costPropagation).toEqual({ quotes: 1, lineItems: 1 })
        expect({
          quote: await quoteRow(db, other.id),
          lines: await linesOf(db, other.id),
        }).toEqual(before)
        expect(await logOf(db, other.id)).toEqual([])
        expect(await logOf(db, draft.id)).toHaveLength(1)
      })
  )

  it("never propagates a price change, nor an unchanged cost", () =>
    withTestDb(async (db) => {
      const { admin, as, product, quoteWithLines } = await setup(db)
      const draft = await quoteWithLines()
      const before = {
        quote: await quoteRow(db, draft.id),
        lines: await linesOf(db, draft.id),
      }
      const result = await as(admin).catalogItem.update({
        id: product.id,
        price: "999",
        cost: "60.00",
        name: "Gateway 2",
      })
      expect(result.costPropagation).toEqual({ quotes: 0, lineItems: 0 })
      expect({
        quote: await quoteRow(db, draft.id),
        lines: await linesOf(db, draft.id),
      }).toEqual(before)
      expect(await logOf(db, draft.id)).toEqual([])
    }))

  it("rewrites every referencing line across Draft Quotes", () =>
    withTestDb(async (db) => {
      const { admin, as, member, product, quoteWithLines } = await setup(db)
      const one = await quoteWithLines("draft", "One")
      const two = await quoteWithLines("draft", "Two")
      await as(member).lineItem.add({
        quoteId: two.id,
        items: [{ sourceKind: "catalog_item", id: product.id }],
      })
      const result = await as(admin).catalogItem.update({
        id: product.id,
        cost: "0",
      })
      expect(result.costPropagation).toEqual({ quotes: 2, lineItems: 3 })
      expect(await logOf(db, one.id)).toHaveLength(1)
      expect(await logOf(db, two.id)).toHaveLength(2)
      const gateways = (await linesOf(db, two.id)).filter(
        (l) => l.sourceKind === "catalog_item"
      )
      expect(gateways.map((l) => l.unitCost)).toEqual(["0.0000", "0.0000"])
    }))
})

describe("Cost Propagation from a Resource Role", () => {
  it("propagates a cost rate change and ignores bill rate changes", () =>
    withTestDb(async (db) => {
      const { admin, as, role, quoteWithLines } = await setup(db)
      const draft = await quoteWithLines()
      const architect = (await linesOf(db, draft.id))[1]!

      const billOnly = await as(admin).resourceRole.update({
        id: role.id,
        billRate: "500",
      })
      expect(billOnly.costPropagation).toEqual({ quotes: 0, lineItems: 0 })
      expect((await linesOf(db, draft.id))[1]).toEqual(architect)

      const before = await quoteRow(db, draft.id)
      const result = await as(admin).resourceRole.update({
        id: role.id,
        costRate: "120",
      })
      expect(result).toMatchObject({
        costRate: "120.0000",
        costPropagation: { quotes: 1, lineItems: 1 },
      })
      const after = (await linesOf(db, draft.id))[1]!
      expect(after).toMatchObject({
        baseCost: "120.0000",
        unitCost: "120.0000",
        unitPrice: architect.unitPrice,
      })
      expect(
        new Decimal(after.lineMarginPct).lessThan(architect.lineMarginPct)
      ).toBe(true)
      const quote = await quoteRow(db, draft.id)
      expect(new Decimal(quote.margin).lessThan(before.margin)).toBe(true)
      expect(await logOf(db, draft.id)).toMatchObject([
        {
          sourceKind: "resource_role",
          sourceName: "Architect",
          oldCost: "100.0000",
          newCost: "120.0000",
        },
      ])
    }))

  it("is Admin-only and isolated", () =>
    withTestDb(async (db) => {
      const { organization, member, as, role, quoteWithLines } = await setup(db)
      const draft = await quoteWithLines()
      await expect(
        as(member).resourceRole.update({ id: role.id, costRate: "1" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
      await expectIsolated(db, {
        owner: organization,
        call: (c) => c.resourceRole.update({ id: role.id, costRate: "1" }),
        snapshot: () => linesOf(db, draft.id),
      })
    }))
})

describe("quote.costChangeLog", () => {
  it("lists the Quote's entries newest first with line, source and actor", () =>
    withTestDb(async (db) => {
      const { admin, member, as, product, role, quoteWithLines } =
        await setup(db)
      const draft = await quoteWithLines()
      await as(admin).catalogItem.update({ id: product.id, cost: "70" })
      await as(admin).resourceRole.update({ id: role.id, costRate: "90" })
      const { entries, currencyCode } = await as(member).quote.costChangeLog({
        id: draft.id,
      })
      expect(currencyCode).toBe("USD")
      expect(entries).toHaveLength(2)
      expect(entries.map((e) => [e.sourceName, e.oldCost, e.newCost])).toEqual(
        expect.arrayContaining([
          ["Gateway", "60.0000", "70.0000"],
          ["Architect", "100.0000", "90.0000"],
        ])
      )
      expect(entries[0]).toMatchObject({
        lineName: expect.any(String),
        actor: { id: admin.user.id, email: admin.user.email },
      })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, admin, as, product, quoteWithLines } =
        await setup(db)
      const draft = await quoteWithLines()
      await as(admin).catalogItem.update({ id: product.id, cost: "70" })
      await expectIsolated(db, {
        owner: organization,
        call: (c) => c.quote.costChangeLog({ id: draft.id }),
      })
    }))
})
