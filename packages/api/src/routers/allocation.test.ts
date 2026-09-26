import { describe, expect, it } from "vitest"

import { asc, eq, inArray, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import { defaultAllocations } from "@workspace/domain/allocations"
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
import type { TestCaller } from "../test"

const { allocations, lineItems, quotes } = schema

/**
 * An Organization with a Member (who owns a Draft Quote, Oct–Dec 2026,
 * Months, USD) and another Member, a Resource Role (150 / 100 an hour), a
 * Product and an hourly Add-on.
 */
async function setup(
  db: Db,
  quoteOverrides: Partial<typeof quotes.$inferInsert> = {}
) {
  const organization = await createOrganization(db)
  const member = await createMember(db, organization, { role: "member" })
  const otherMember = await createMember(db, organization, { role: "member" })
  const admin = await createMember(db, organization, { role: "admin" })
  const people = { member, otherMember, admin }
  const caller = (who: keyof typeof people = "member") =>
    organizationCaller(db, { organization, user: people[who].user })
  const quote = await createQuote(db, organization, {
    owner: member.user,
    ...quoteOverrides,
  })
  const role = await createResourceRole(db, organization, {
    name: "Architect",
    billRate: "150",
    costRate: "100",
  })
  const product = await createCatalogItem(db, organization, {
    type: "Product",
    name: "Gateway",
    price: "100",
    cost: "60",
  })
  const addOn = await createCatalogItem(db, organization, {
    type: "Add-on",
    name: "Training",
    price: "80",
    cost: "50",
    billingUnit: "hour",
  })
  return { organization, people, caller, quote, role, product, addOn }
}

async function addLines(
  caller: TestCaller,
  quoteId: string,
  items: { sourceKind: "catalog_item" | "resource_role"; id: string }[]
) {
  return (await caller.lineItem.add({ quoteId, items })).lines
}

const cellsOf = async (db: Db, lineId: string) =>
  (
    await db
      .select()
      .from(allocations)
      .where(eq(allocations.lineItemId, lineId))
      .orderBy(asc(allocations.periodStart))
  ).map((a) => [a.periodType, a.periodStart, a.amount])

const lineRow = async (db: Db, id: string) =>
  (await db.select().from(lineItems).where(eq(lineItems.id, id)))[0]!

const quoteRow = async (db: Db, id: string) =>
  (await db.select().from(quotes).where(eq(quotes.id, id)))[0]!

describe("allocation.setRange", () => {
  it("writes a range as one command and keeps quantity = Σ Allocations", () =>
    withTestDb(async (db) => {
      const { caller, quote, role } = await setup(db)
      const [line] = await addLines(caller(), quote.id, [
        { sourceKind: "resource_role", id: role.id },
      ])
      const result = await caller().allocation.setRange({
        quoteId: quote.id,
        cells: [
          { lineItemId: line!.id, periodStart: "2026-10-01", amount: "40" },
          { lineItemId: line!.id, periodStart: "2026-11-01", amount: "60" },
          { lineItemId: line!.id, periodStart: "2026-12-01", amount: null },
        ],
      })
      expect(result.lines).toHaveLength(1)
      expect(result.lines[0]).toMatchObject({
        id: line!.id,
        plannerManaged: true,
        quantity: "100.000",
        lineTotal: "15000.0000",
        startDate: "2026-10-01",
        // The end follows the last allocated bucket.
        endDate: "2026-11-30",
        allocations: [
          { periodStart: "2026-10-01", amount: "40.000" },
          { periodStart: "2026-11-01", amount: "60.000" },
        ],
      })
      expect(result.totals).toMatchObject({
        subtotal: "15000.0000",
        total: "15000.0000",
      })
      expect(result.undoToken).toEqual(expect.any(String))
      expect(await cellsOf(db, line!.id)).toEqual([
        ["month", "2026-10-01", "40.000"],
        ["month", "2026-11-01", "60.000"],
      ])
      expect((await lineRow(db, line!.id)).quantity).toBe("100.000")
      expect((await quoteRow(db, quote.id)).total).toBe("15000.0000")

      // quote.editor carries the Allocations too.
      const editor = await caller("otherMember").quote.editor({ id: quote.id })
      expect(editor.lines[0]!.allocations).toEqual(result.lines[0]!.allocations)
    }))

  it("lays out an untouched line with its default Allocations first", () =>
    withTestDb(async (db) => {
      const { caller, quote, role } = await setup(db)
      const [line] = await addLines(caller(), quote.id, [
        { sourceKind: "resource_role", id: role.id },
      ])
      expect(line).toMatchObject({ plannerManaged: false, allocations: [] })
      const shown = defaultAllocations({
        timePeriod: "months",
        billingUnit: "hour",
        quantity: line!.quantity,
        startDate: line!.startDate,
        endDate: line!.endDate,
      })
      const result = await caller().allocation.setRange({
        quoteId: quote.id,
        cells: [
          { lineItemId: line!.id, periodStart: "2026-11-01", amount: "100" },
        ],
      })
      const expected = shown.map((a) =>
        a.periodStart === "2026-11-01" ? { ...a, amount: "100.000" } : a
      )
      expect(result.lines[0]!.allocations).toEqual(expected)
      const sum = expected.reduce((n, a) => n + Number(a.amount), 0)
      expect(Number(result.lines[0]!.quantity)).toBe(sum)
    }))

  it("normalises periods to the bucket start, last cell wins", () =>
    withTestDb(async (db) => {
      const { caller, quote, role } = await setup(db, {
        timePeriod: "weeks",
      })
      const [line] = await addLines(caller(), quote.id, [
        { sourceKind: "resource_role", id: role.id },
      ])
      await caller().allocation.setRange({
        quoteId: quote.id,
        cells: [
          // Wed 7 Oct 2026 → Monday 5 Oct.
          { lineItemId: line!.id, periodStart: "2026-10-07", amount: "10" },
          { lineItemId: line!.id, periodStart: "2026-10-09", amount: "12" },
        ],
      })
      const cells = await cellsOf(db, line!.id)
      expect(cells.filter(([, start]) => start === "2026-10-05")).toEqual([
        ["week", "2026-10-05", "12.000"],
      ])
      expect(cells.every(([type]) => type === "week")).toBe(true)
      const starts = cells.map(([, start]) => start)
      expect(new Set(starts).size).toBe(starts.length)
    }))

  it.each([
    ["months", "2026-10-01", "744", "745"],
    ["weeks", "2026-10-05", "168", "169"],
    ["quarters", "2026-10-01", "2160", "2161"],
  ] as const)(
    "caps a %s cell at %s… (%s ok, %s refused)",
    (timePeriod, periodStart, max, over) =>
      withTestDb(async (db) => {
        const { caller, quote, role } = await setup(db, { timePeriod })
        const [line] = await addLines(caller(), quote.id, [
          { sourceKind: "resource_role", id: role.id },
        ])
        await expect(
          caller().allocation.setRange({
            quoteId: quote.id,
            cells: [{ lineItemId: line!.id, periodStart, amount: over }],
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
        expect(await cellsOf(db, line!.id)).toEqual([])
        const ok = await caller().allocation.setRange({
          quoteId: quote.id,
          cells: [{ lineItemId: line!.id, periodStart, amount: max }],
        })
        expect(ok.lines[0]!.allocations).toContainEqual({
          periodStart,
          amount: `${max}.000`,
        })
      })
  )

  it("rejects the whole batch when one cell is bad", () =>
    withTestDb(async (db) => {
      const { caller, quote, role } = await setup(db)
      const [a, b] = await addLines(caller(), quote.id, [
        { sourceKind: "resource_role", id: role.id },
        { sourceKind: "resource_role", id: role.id },
      ])
      await caller().allocation.setRange({
        quoteId: quote.id,
        cells: [{ lineItemId: a!.id, periodStart: "2026-10-01", amount: "10" }],
      })
      const before = {
        quote: await quoteRow(db, quote.id),
        a: await lineRow(db, a!.id),
        b: await lineRow(db, b!.id),
        aCells: await cellsOf(db, a!.id),
      }
      for (const bad of [
        { lineItemId: b!.id, periodStart: "2026-12-01", amount: "800" },
        { lineItemId: b!.id, periodStart: "2027-02-01", amount: "8" },
        { lineItemId: b!.id, periodStart: "2026-09-01", amount: "8" },
        { lineItemId: b!.id, periodStart: "2026-12-01", amount: "-1" },
      ]) {
        await expect(
          caller().allocation.setRange({
            quoteId: quote.id,
            cells: [
              { lineItemId: a!.id, periodStart: "2026-10-01", amount: "20" },
              { lineItemId: b!.id, periodStart: "2026-10-01", amount: "20" },
              bad,
            ],
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
      expect({
        quote: await quoteRow(db, quote.id),
        a: await lineRow(db, a!.id),
        b: await lineRow(db, b!.id),
        aCells: await cellsOf(db, a!.id),
      }).toEqual(before)
      expect(await cellsOf(db, b!.id)).toEqual([])
    }))

  it("refuses lines that aren't Resource Role lines, and other Quotes' lines", () =>
    withTestDb(async (db) => {
      const { organization, people, caller, quote, role, product, addOn } =
        await setup(db)
      const [roleLine, productLine, addOnLine] = await addLines(
        caller(),
        quote.id,
        [
          { sourceKind: "resource_role", id: role.id },
          { sourceKind: "catalog_item", id: product.id },
          { sourceKind: "catalog_item", id: addOn.id },
        ]
      )
      for (const other of [productLine!, addOnLine!]) {
        await expect(
          caller().allocation.setRange({
            quoteId: quote.id,
            cells: [
              {
                lineItemId: roleLine!.id,
                periodStart: "2026-10-01",
                amount: "8",
              },
              { lineItemId: other.id, periodStart: "2026-10-01", amount: "8" },
            ],
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
      expect(await cellsOf(db, roleLine!.id)).toEqual([])

      const otherQuote = await createQuote(db, organization, {
        owner: people.member.user,
      })
      await expect(
        caller().allocation.setRange({
          quoteId: otherQuote.id,
          cells: [
            {
              lineItemId: roleLine!.id,
              periodStart: "2026-10-01",
              amount: "8",
            },
          ],
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("clears a row and restores it with undo", () =>
    withTestDb(async (db) => {
      const { caller, quote, role } = await setup(db)
      const [line] = await addLines(caller(), quote.id, [
        { sourceKind: "resource_role", id: role.id },
      ])
      await caller().allocation.setRange({
        quoteId: quote.id,
        cells: ["2026-10-01", "2026-11-01", "2026-12-01"].map(
          (periodStart) => ({
            lineItemId: line!.id,
            periodStart,
            amount: "50",
          })
        ),
      })
      const planned = await lineRow(db, line!.id)
      const cleared = await caller().allocation.setRange({
        quoteId: quote.id,
        cells: ["2026-10-01", "2026-11-01", "2026-12-01"].map(
          (periodStart) => ({
            lineItemId: line!.id,
            periodStart,
            amount: null,
          })
        ),
      })
      expect(cleared.lines[0]).toMatchObject({
        quantity: "0.000",
        lineTotal: "0.0000",
        plannerManaged: false,
        allocations: [],
      })
      expect(cleared.totals.total).toBe("0.0000")

      const restored = await caller().allocation.restore({
        quoteId: quote.id,
        undoToken: cleared.undoToken,
      })
      expect(restored.lines[0]).toMatchObject({
        quantity: "150.000",
        plannerManaged: true,
      })
      expect(restored.totals.total).toBe("22500.0000")
      const after = await lineRow(db, line!.id)
      expect({ ...after, updatedAt: null }).toEqual({
        ...planned,
        updatedAt: null,
      })
      expect(await cellsOf(db, line!.id)).toHaveLength(3)
      await expect(
        caller().allocation.restore({
          quoteId: quote.id,
          undoToken: cleared.undoToken,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("won't undo after the line was deleted", () =>
    withTestDb(async (db) => {
      const { caller, quote, role } = await setup(db)
      const [line] = await addLines(caller(), quote.id, [
        { sourceKind: "resource_role", id: role.id },
      ])
      const set = await caller().allocation.setRange({
        quoteId: quote.id,
        cells: [
          { lineItemId: line!.id, periodStart: "2026-10-01", amount: "8" },
        ],
      })
      await caller().lineItem.delete({ quoteId: quote.id, ids: [line!.id] })
      await expect(
        caller().allocation.restore({
          quoteId: quote.id,
          undoToken: set.undoToken,
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    }))
})

describe("permissions and the lock", () => {
  it.each(LOCKED_STAGES)(
    "refuses planner commands while %s",
    (stage: QuoteStage) =>
      withTestDb(async (db) => {
        const { caller, quote, role } = await setup(db)
        const [line] = await addLines(caller(), quote.id, [
          { sourceKind: "resource_role", id: role.id },
        ])
        const { undoToken } = await caller().allocation.setRange({
          quoteId: quote.id,
          cells: [
            { lineItemId: line!.id, periodStart: "2026-10-01", amount: "8" },
          ],
        })
        await setQuoteStage(db, quote, stage)
        await expect(
          caller("admin").allocation.setRange({
            quoteId: quote.id,
            cells: [
              { lineItemId: line!.id, periodStart: "2026-10-01", amount: "9" },
            ],
          })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
        await expect(
          caller("admin").allocation.restore({ quoteId: quote.id, undoToken })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
        expect(
          (await cellsOf(db, line!.id)).find(([, s]) => s === "2026-10-01")
        ).toEqual(["month", "2026-10-01", "8.000"])
      })
  )

  it("refuses another Member's Quote", () =>
    withTestDb(async (db) => {
      const { caller, quote, role } = await setup(db)
      const [line] = await addLines(caller(), quote.id, [
        { sourceKind: "resource_role", id: role.id },
      ])
      await expect(
        caller("otherMember").allocation.setRange({
          quoteId: quote.id,
          cells: [
            { lineItemId: line!.id, periodStart: "2026-10-01", amount: "8" },
          ],
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    }))
})

describe("tenancy isolation", () => {
  it.each(["allocation.setRange", "allocation.restore"] as const)(
    "%s is isolated from other Organizations",
    (procedure) =>
      withTestDb(async (db) => {
        const { organization, caller, quote, role } = await setup(db)
        const [line] = await addLines(caller(), quote.id, [
          { sourceKind: "resource_role", id: role.id },
        ])
        const { undoToken } = await caller().allocation.setRange({
          quoteId: quote.id,
          cells: [
            { lineItemId: line!.id, periodStart: "2026-10-01", amount: "0" },
          ],
        })
        await expectIsolated(db, {
          owner: organization,
          call: (c) =>
            procedure === "allocation.setRange"
              ? c.allocation.setRange({
                  quoteId: quote.id,
                  cells: [
                    {
                      lineItemId: line!.id,
                      periodStart: "2026-10-01",
                      amount: "99",
                    },
                  ],
                })
              : c.allocation.restore({ quoteId: quote.id, undoToken }),
          snapshot: async () => ({
            quote: await quoteRow(db, quote.id),
            line: await lineRow(db, line!.id),
            cells: await db
              .select()
              .from(allocations)
              .where(inArray(allocations.lineItemId, [line!.id])),
          }),
        })
      })
  )
})
