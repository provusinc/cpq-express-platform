import { describe, expect, it } from "vitest"

import { asc, eq, inArray, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import type { QuoteStage } from "@workspace/domain/enums"
import { LOCKED_STAGES } from "@workspace/domain/stages"

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

const { allocations, lineItems, quotes } = schema

/**
 * A Member's Draft Quote (Oct–Dec 2026, Months, USD) with a Resource Role
 * line planned Oct 40 / Nov 60 / Dec 20 h at 150 (18,000) and a Product
 * line (1 × 100).
 */
async function setup(db: Db) {
  const organization = await createOrganization(db)
  const member = await createMember(db, organization, { role: "member" })
  const admin = await createMember(db, organization, { role: "admin" })
  const caller = (who: "member" | "admin" = "member") =>
    organizationCaller(db, {
      organization,
      user: (who === "member" ? member : admin).user,
    })
  const quote = await createQuote(db, organization, { owner: member.user })
  const role = await createResourceRole(db, organization, {
    billRate: "150",
    costRate: "100",
  })
  const product = await createCatalogItem(db, organization, {
    kind: "product",
    price: "100",
    cost: "60",
  })
  const added = await caller().lineItem.add({
    quoteId: quote.id,
    items: [
      { sourceKind: "resource_role", id: role.id },
      { sourceKind: "product", id: product.id },
    ],
  })
  const [roleLine, productLine] = added.lines
  await caller().allocation.setRange({
    quoteId: quote.id,
    cells: [
      { lineItemId: roleLine!.id, periodStart: "2026-10-01", amount: "40" },
      { lineItemId: roleLine!.id, periodStart: "2026-11-01", amount: "60" },
      { lineItemId: roleLine!.id, periodStart: "2026-12-01", amount: "20" },
    ],
  })
  return {
    organization,
    caller,
    quote,
    roleLine: roleLine!,
    productLine: productLine!,
  }
}

const quoteRow = async (db: Db, id: string) =>
  (await db.select().from(quotes).where(eq(quotes.id, id)))[0]!

const lineRow = async (db: Db, id: string) =>
  (await db.select().from(lineItems).where(eq(lineItems.id, id)))[0]!

const cellsOf = async (db: Db, lineId: string) =>
  Object.fromEntries(
    (
      await db
        .select()
        .from(allocations)
        .where(eq(allocations.lineItemId, lineId))
        .orderBy(asc(allocations.periodStart))
    ).map((a) => [a.periodStart, a.amount])
  )

/** Everything a date change could touch. */
const snapshot = async (db: Db, quoteId: string) => {
  const lines = await db
    .select()
    .from(lineItems)
    .where(eq(lineItems.quoteId, quoteId))
    .orderBy(asc(lineItems.id))
  return {
    quote: await quoteRow(db, quoteId),
    lines,
    allocations: await db
      .select()
      .from(allocations)
      .where(
        inArray(
          allocations.lineItemId,
          lines.map((l) => l.id)
        )
      )
      .orderBy(asc(allocations.id)),
  }
}

describe("quote.setDates", () => {
  it("shifts the whole Quote by default, keeping all Effort", () =>
    withTestDb(async (db) => {
      const { caller, quote, roleLine, productLine } = await setup(db)
      const result = await caller().quote.setDates({
        id: quote.id,
        startDate: "2026-11-01",
        endDate: "2027-01-31",
      })
      expect(result).toMatchObject({
        preview: false,
        startDate: "2026-11-01",
        endDate: "2027-01-31",
        impact: {
          mode: "shift",
          impactedCount: 2,
          clampedCount: 0,
          effortReducedCount: 0,
          oldTotal: "18100.0000",
          newTotal: "18100.0000",
        },
      })
      expect(await quoteRow(db, quote.id)).toMatchObject({
        startDate: "2026-11-01",
        endDate: "2027-01-31",
        total: "18100.0000",
      })
      expect(await cellsOf(db, roleLine.id)).toEqual({
        "2026-11-01": "40.000",
        "2026-12-01": "60.000",
        "2027-01-01": "20.000",
      })
      expect(await lineRow(db, roleLine.id)).toMatchObject({
        startDate: "2026-11-01",
        endDate: "2027-01-31",
        quantity: "120.000",
      })
      expect(await lineRow(db, productLine.id)).toMatchObject({
        startDate: "2026-11-01",
        endDate: "2027-01-31",
        quantity: "1.000",
      })
      const moved = result.preview ? [] : result.lines
      expect(moved.find((l) => l.id === roleLine.id)?.allocations).toEqual([
        { periodStart: "2026-11-01", amount: "40.000" },
        { periodStart: "2026-12-01", amount: "60.000" },
        { periodStart: "2027-01-01", amount: "20.000" },
      ])
    }))

  it("clamps overrunning lines and trims Allocations when the end moves in", () =>
    withTestDb(async (db) => {
      const { caller, quote, roleLine, productLine } = await setup(db)
      const result = await caller().quote.setDates({
        id: quote.id,
        startDate: "2026-10-01",
        endDate: "2026-11-30",
      })
      expect(result.impact).toMatchObject({
        mode: "shift",
        impactedCount: 2,
        clampedCount: 2,
        effortReducedCount: 1,
        oldTotal: "18100.0000",
        newTotal: "15100.0000",
      })
      expect(await cellsOf(db, roleLine.id)).toEqual({
        "2026-10-01": "40.000",
        "2026-11-01": "60.000",
      })
      expect(await lineRow(db, roleLine.id)).toMatchObject({
        endDate: "2026-11-30",
        quantity: "100.000",
      })
      expect(await lineRow(db, productLine.id)).toMatchObject({
        endDate: "2026-11-30",
        quantity: "1.000",
      })
      expect((await quoteRow(db, quote.id)).total).toBe("15100.0000")
    }))

  it("clamps a start move when asked", () =>
    withTestDb(async (db) => {
      const { caller, quote, roleLine } = await setup(db)
      await caller().quote.setDates({
        id: quote.id,
        startDate: "2026-11-01",
        endDate: "2026-12-31",
        mode: "clamp",
      })
      expect(await quoteRow(db, quote.id)).toMatchObject({
        startDate: "2026-11-01",
        endDate: "2026-12-31",
      })
      expect(await cellsOf(db, roleLine.id)).toEqual({
        "2026-11-01": "60.000",
        "2026-12-01": "20.000",
      })
    }))

  it("changes nothing else when the dates move outward", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const before = await snapshot(db, quote.id)
      const result = await caller().quote.setDates({
        id: quote.id,
        startDate: "2026-09-01",
        endDate: "2027-03-31",
        mode: "clamp",
      })
      expect(result.impact.impactedCount).toBe(0)
      const after = await snapshot(db, quote.id)
      expect(after.lines).toEqual(before.lines)
      expect(after.allocations).toEqual(before.allocations)
      expect(after.quote).toMatchObject({
        startDate: "2026-09-01",
        endDate: "2027-03-31",
        total: before.quote.total,
      })
    }))

  it("previews the impact without persisting anything", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const before = await snapshot(db, quote.id)
      const preview = await caller().quote.setDates({
        id: quote.id,
        startDate: "2026-10-01",
        endDate: "2026-11-30",
        preview: true,
      })
      expect(preview).toMatchObject({
        preview: true,
        startDate: "2026-10-01",
        endDate: "2026-11-30",
        impact: { clampedCount: 2, newTotal: "15100.0000" },
      })
      expect(preview).not.toHaveProperty("lines")
      expect(await snapshot(db, quote.id)).toEqual(before)

      const applied = await caller().quote.setDates({
        id: quote.id,
        startDate: "2026-10-01",
        endDate: "2026-11-30",
      })
      expect(applied.impact).toEqual(preview.impact)
      expect(applied.preview ? null : applied.totals.total).toBe(
        preview.impact.newTotal
      )
    }))

  it("refuses impossible dates", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      for (const dates of [
        { startDate: "2026-10-01", endDate: "2026-09-30" },
        // A clamped start past every line's end.
        { startDate: "2027-01-15", endDate: "2027-02-28" },
      ]) {
        await expect(
          caller().quote.setDates({ id: quote.id, mode: "clamp", ...dates })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
      await expect(
        caller().quote.setDates({
          id: quote.id,
          startDate: "2026-10-1",
          endDate: "2026-12-31",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))

  it("makes an earlier delete impossible to undo", () =>
    withTestDb(async (db) => {
      const { caller, quote, productLine } = await setup(db)
      const { undoToken } = await caller().lineItem.delete({
        quoteId: quote.id,
        ids: [productLine.id],
      })
      await caller().quote.setDates({
        id: quote.id,
        startDate: "2026-10-05",
        endDate: "2027-01-04",
      })
      await expect(
        caller().lineItem.restore({ quoteId: quote.id, undoToken })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    }))
})

describe("quote.setTimePeriod", () => {
  it("discards every Allocation on the Quote and keeps quantities", () =>
    withTestDb(async (db) => {
      const { caller, quote, roleLine } = await setup(db)
      const result = await caller().quote.setTimePeriod({
        id: quote.id,
        timePeriod: "weeks",
      })
      expect(result).toMatchObject({
        timePeriod: "weeks",
        discardedAllocations: 3,
        totals: { total: "18100.0000" },
      })
      expect(result.lines).toEqual([
        expect.objectContaining({
          id: roleLine.id,
          plannerManaged: false,
          allocations: [],
          quantity: "120.000",
        }),
      ])
      expect(await cellsOf(db, roleLine.id)).toEqual({})
      expect((await quoteRow(db, quote.id)).timePeriod).toBe("weeks")

      // The Planner then lays the line out in weeks.
      const planned = await caller().allocation.setRange({
        quoteId: quote.id,
        cells: [
          { lineItemId: roleLine.id, periodStart: "2026-10-07", amount: "8" },
        ],
      })
      expect(planned.lines[0]!.allocations).toContainEqual({
        periodStart: "2026-10-05",
        amount: "8.000",
      })
    }))

  it("keeps Allocations when the Time Period doesn't change", () =>
    withTestDb(async (db) => {
      const { caller, quote, roleLine } = await setup(db)
      const result = await caller().quote.setTimePeriod({
        id: quote.id,
        timePeriod: "months",
      })
      expect(result.discardedAllocations).toBe(0)
      expect(Object.keys(await cellsOf(db, roleLine.id))).toHaveLength(3)
    }))
})

describe("lineItem.update start on a planner-managed line", () => {
  it("lifts and shifts the Allocations, trimmed at the Quote End Date", () =>
    withTestDb(async (db) => {
      const { caller, quote, roleLine } = await setup(db)
      const result = await caller().lineItem.update({
        quoteId: quote.id,
        id: roleLine.id,
        startDate: "2026-11-01",
      })
      expect(result.lines[0]).toMatchObject({
        startDate: "2026-11-01",
        endDate: "2026-12-31",
        quantity: "100.000",
        lineTotal: "15000.0000",
        allocations: [
          { periodStart: "2026-11-01", amount: "40.000" },
          { periodStart: "2026-12-01", amount: "60.000" },
        ],
      })
      expect(await cellsOf(db, roleLine.id)).toEqual({
        "2026-11-01": "40.000",
        "2026-12-01": "60.000",
      })
      // The Quote dates never change.
      expect(await quoteRow(db, quote.id)).toMatchObject({
        startDate: "2026-10-01",
        endDate: "2026-12-31",
      })

      // And back earlier: the block moves back, the trimmed Effort stays gone.
      const back = await caller().lineItem.update({
        quoteId: quote.id,
        id: roleLine.id,
        startDate: "2026-10-01",
      })
      expect(back.lines[0]!.allocations).toEqual([
        { periodStart: "2026-10-01", amount: "40.000" },
        { periodStart: "2026-11-01", amount: "60.000" },
      ])
    }))

  it("refuses a start outside the Quote dates", () =>
    withTestDb(async (db) => {
      const { caller, quote, roleLine } = await setup(db)
      await expect(
        caller().lineItem.update({
          quoteId: quote.id,
          id: roleLine.id,
          startDate: "2027-01-05",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))
})

describe("permissions, lock and isolation", () => {
  it.each(LOCKED_STAGES)(
    "refuses date and Time Period changes while %s, preview included",
    (stage: QuoteStage) =>
      withTestDb(async (db) => {
        const { caller, quote } = await setup(db)
        await setQuoteStage(db, quote, stage)
        const before = await snapshot(db, quote.id)
        for (const attempt of [
          () =>
            caller("admin").quote.setDates({
              id: quote.id,
              startDate: "2026-11-01",
              endDate: "2027-01-31",
              preview: true,
            }),
          () =>
            caller("admin").quote.setDates({
              id: quote.id,
              startDate: "2026-11-01",
              endDate: "2027-01-31",
            }),
          () =>
            caller("admin").quote.setTimePeriod({
              id: quote.id,
              timePeriod: "weeks",
            }),
        ]) {
          await expect(attempt()).rejects.toMatchObject({
            code: "PRECONDITION_FAILED",
          })
        }
        expect(await snapshot(db, quote.id)).toEqual(before)
      })
  )

  it.each(["quote.setDates", "quote.setTimePeriod"] as const)(
    "%s is isolated from other Organizations",
    (procedure) =>
      withTestDb(async (db) => {
        const { organization, quote } = await setup(db)
        await expectIsolated(db, {
          owner: organization,
          call: (c) =>
            procedure === "quote.setDates"
              ? c.quote.setDates({
                  id: quote.id,
                  startDate: "2026-11-01",
                  endDate: "2027-01-31",
                })
              : c.quote.setTimePeriod({ id: quote.id, timePeriod: "weeks" }),
          snapshot: () => snapshot(db, quote.id),
        })
      })
  )
})
