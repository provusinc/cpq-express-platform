import { describe, expect, it } from "vitest"

import { asc, eq, schema } from "@workspace/db"
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
import type { TestCaller } from "../test"

const { allocations, lineItems, phases, quotes } = schema

/**
 * An Organization with a Member who owns a Draft Quote (Oct–Dec 2026,
 * Months), another Member, an Admin, a Product (100 / 60) and a Resource
 * Role (150 / 100 an hour).
 */
async function setup(db: Db) {
  const organization = await createOrganization(db)
  const members = {
    admin: await createMember(db, organization, { role: "admin" }),
    member: await createMember(db, organization, { role: "member" }),
    otherMember: await createMember(db, organization, { role: "member" }),
  }
  const caller = (who: keyof typeof members) =>
    organizationCaller(db, { organization, user: members[who].user })
  const quote = await createQuote(db, organization, {
    owner: members.member.user,
  })
  const product = await createCatalogItem(db, organization, {
    kind: "product",
    name: "Gateway",
    price: "100",
    cost: "60",
  })
  const role = await createResourceRole(db, organization, {
    name: "Architect",
    billRate: "150",
    costRate: "100",
  })
  return { organization, members, caller, quote, product, role }
}

const phaseRows = (db: Db, quoteId: string) =>
  db
    .select()
    .from(phases)
    .where(eq(phases.quoteId, quoteId))
    .orderBy(asc(phases.sequence), asc(phases.id))

const lineRows = (db: Db, quoteId: string) =>
  db
    .select()
    .from(lineItems)
    .where(eq(lineItems.quoteId, quoteId))
    .orderBy(asc(lineItems.sequence), asc(lineItems.id))

const quoteRow = async (db: Db, id: string) =>
  (await db.select().from(quotes).where(eq(quotes.id, id)))[0]!

/** Creates a Phase through the API and returns its id. */
async function createPhase(
  caller: TestCaller,
  quoteId: string,
  name: string,
  parentId: string | null = null
) {
  const result = await caller.phase.create({ quoteId, name, parentId })
  return result.phases[0]!.id
}

/** Adds `n` Product lines into `phaseId` and returns their ids. */
async function addLines(
  caller: TestCaller,
  quoteId: string,
  productId: string,
  phaseId: string | null,
  n = 1
) {
  const result = await caller.lineItem.add({
    quoteId,
    phaseId,
    items: Array.from({ length: n }, () => ({
      sourceKind: "product" as const,
      id: productId,
    })),
  })
  return result.lines.map((l) => l.id)
}

/** The Quote's grid as `name@parent` for Phases and `line@phase` for lines. */
async function editorOrder(caller: TestCaller, quoteId: string) {
  const editor = await caller.quote.editor({ id: quoteId })
  return {
    phases: editor.phases.map((p) => [p.name, p.parentId, p.sequence]),
    lines: editor.lines.map((l) => [l.id, l.phaseId]),
  }
}

describe("phase.create / rename", () => {
  it("creates Phases at the end of their siblings and returns the editor result", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const first = await caller("member").phase.create({
        quoteId: quote.id,
        name: "Discovery",
      })
      expect(first).toMatchObject({
        quoteId: quote.id,
        lines: [],
        deletedLineIds: [],
        deletedPhaseIds: [],
        phases: [{ name: "Discovery", parentId: null, sequence: 0 }],
        totals: { total: "0.0000" },
      })
      const discovery = first.phases[0]!.id
      await createPhase(caller("member"), quote.id, "Build")
      await createPhase(caller("member"), quote.id, "Workshops", discovery)
      await createPhase(caller("member"), quote.id, "Interviews", discovery)
      expect(
        (await phaseRows(db, quote.id)).map((p) => [
          p.name,
          p.parentId,
          p.sequence,
        ])
      ).toEqual([
        ["Discovery", null, 0],
        ["Workshops", discovery, 0],
        ["Build", null, 1],
        ["Interviews", discovery, 1],
      ])

      const renamed = await caller("member").phase.rename({
        quoteId: quote.id,
        id: discovery,
        name: "  Assess  ",
      })
      expect(renamed.phases).toEqual([
        { id: discovery, parentId: null, name: "Assess", sequence: 0 },
      ])
    }))

  it("enforces the three-level depth limit on create", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const one = await createPhase(caller("member"), quote.id, "One")
      const two = await createPhase(caller("member"), quote.id, "Two", one)
      const three = await createPhase(caller("member"), quote.id, "Three", two)
      await expect(
        caller("member").phase.create({
          quoteId: quote.id,
          name: "Four",
          parentId: three,
        })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Phases can nest at most 3 levels deep.",
      })
      expect(await phaseRows(db, quote.id)).toHaveLength(3)
    }))

  it("refuses a parent from another Quote and a blank name", () =>
    withTestDb(async (db) => {
      const { organization, members, caller, quote } = await setup(db)
      const other = await createQuote(db, organization, {
        owner: members.member.user,
      })
      const foreign = await createPhase(caller("member"), other.id, "Other")
      await expect(
        caller("member").phase.create({
          quoteId: quote.id,
          name: "X",
          parentId: foreign,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(
        caller("member").phase.rename({
          quoteId: quote.id,
          id: foreign,
          name: "X",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(
        caller("member").phase.create({ quoteId: quote.id, name: "   " })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))
})

describe("phase.move", () => {
  it("reorders among siblings and re-parents with its subtree", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const c = caller("member")
      const a = await createPhase(c, quote.id, "A")
      const b = await createPhase(c, quote.id, "B")
      const d = await createPhase(c, quote.id, "D")
      const a1 = await createPhase(c, quote.id, "A1", a)

      const reordered = await c.phase.move({
        quoteId: quote.id,
        id: d,
        parentId: null,
        beforeId: a,
      })
      expect(reordered.phases.map((p) => [p.name, p.sequence])).toEqual([
        ["D", 0],
        ["A", 1],
        ["B", 2],
      ])

      // A (with A1) moves inside B, at the end.
      await c.phase.move({ quoteId: quote.id, id: a, parentId: b })
      const rows = await phaseRows(db, quote.id)
      const byName = Object.fromEntries(rows.map((p) => [p.name, p]))
      expect(byName.A).toMatchObject({ parentId: b, sequence: 0 })
      expect(byName.A1).toMatchObject({ parentId: a })
      expect(byName.D).toMatchObject({ parentId: null, sequence: 0 })
      expect(byName.B).toMatchObject({ parentId: null, sequence: 2 })
      expect(a1).toBeTruthy()
    }))

  it("refuses moves that nest too deep, into itself, or before a non-sibling", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const c = caller("member")
      const a = await createPhase(c, quote.id, "A")
      const a1 = await createPhase(c, quote.id, "A1", a)
      await createPhase(c, quote.id, "A2", a1)
      const b = await createPhase(c, quote.id, "B")
      const b1 = await createPhase(c, quote.id, "B1", b)
      const before = await phaseRows(db, quote.id)

      // A has three levels, so it can't go under anything.
      await expect(
        c.phase.move({ quoteId: quote.id, id: a, parentId: b })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Phases can nest at most 3 levels deep.",
      })
      await expect(
        c.phase.move({ quoteId: quote.id, id: a, parentId: a1 })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      await expect(
        c.phase.move({ quoteId: quote.id, id: b, parentId: null, beforeId: b1 })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      expect(await phaseRows(db, quote.id)).toEqual(before)
    }))
})

describe("phase.delete / restore", () => {
  it("cascades to descendant Phases, their Line Items and Allocations, and undoes exactly", () =>
    withTestDb(async (db) => {
      const { organization, caller, quote, product, role } = await setup(db)
      const c = caller("member")
      const keep = await createPhase(c, quote.id, "Keep")
      const gone = await createPhase(c, quote.id, "Gone")
      const child = await createPhase(c, quote.id, "Child", gone)
      const grandchild = await createPhase(c, quote.id, "Grandchild", child)
      const [kept] = await addLines(c, quote.id, product.id, keep)
      await addLines(c, quote.id, product.id, gone, 2)
      const roleLine = (
        await c.lineItem.add({
          quoteId: quote.id,
          phaseId: grandchild,
          items: [{ sourceKind: "resource_role", id: role.id }],
        })
      ).lines[0]!
      await db.insert(allocations).values({
        organizationId: organization.id,
        lineItemId: roleLine.id,
        periodType: "month",
        periodStart: "2026-10-01",
        amount: "160",
      })
      const beforePhases = await phaseRows(db, quote.id)
      const beforeLines = await lineRows(db, quote.id)
      const beforeAllocations = await db.select().from(allocations)
      expect((await quoteRow(db, quote.id)).total).toBe("24300.0000")

      const deleted = await c.phase.delete({ quoteId: quote.id, id: gone })
      expect(new Set(deleted.deletedPhaseIds)).toEqual(
        new Set([gone, child, grandchild])
      )
      expect(deleted.deletedLineIds).toHaveLength(3)
      expect(deleted.totals.total).toBe("100.0000")
      expect(deleted.undoToken).toEqual(expect.any(String))
      expect((await phaseRows(db, quote.id)).map((p) => p.id)).toEqual([keep])
      expect((await lineRows(db, quote.id)).map((l) => l.id)).toEqual([kept])
      expect(
        await db
          .select()
          .from(allocations)
          .where(eq(allocations.lineItemId, roleLine.id))
      ).toEqual([])

      const restored = await c.phase.restore({
        quoteId: quote.id,
        undoToken: deleted.undoToken,
      })
      expect(restored.phases).toHaveLength(3)
      expect(restored.lines).toHaveLength(3)
      expect(restored.totals.total).toBe("24300.0000")
      const strip = <T extends { updatedAt: Date; createdAt: Date }>(
        rows: T[]
      ) =>
        rows.map((row) => {
          const rest: Partial<T> = { ...row }
          delete rest.updatedAt
          delete rest.createdAt
          return rest
        })
      expect(strip(await phaseRows(db, quote.id))).toEqual(strip(beforePhases))
      expect(strip(await lineRows(db, quote.id))).toEqual(
        strip(beforeLines).map((l) => ({
          ...l,
          lineTotal: expect.any(String),
          lineMarginPct: expect.any(String),
        }))
      )
      expect(strip(await db.select().from(allocations))).toEqual(
        strip(beforeAllocations)
      )

      // The token is used up.
      await expect(
        c.phase.restore({ quoteId: quote.id, undoToken: deleted.undoToken })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("restores at the top level when the parent has gone", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const c = caller("member")
      const parent = await createPhase(c, quote.id, "Parent")
      const child = await createPhase(c, quote.id, "Child", parent)
      const { undoToken } = await c.phase.delete({
        quoteId: quote.id,
        id: child,
      })
      await c.phase.delete({ quoteId: quote.id, id: parent })
      const restored = await c.phase.restore({ quoteId: quote.id, undoToken })
      expect(restored.phases).toEqual([
        expect.objectContaining({ id: child, parentId: null }),
      ])
    }))

  it("refuses the undo once the Quote's dates changed", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db)
      const c = caller("member")
      const phase = await createPhase(c, quote.id, "P")
      await addLines(c, quote.id, product.id, phase)
      const { undoToken } = await c.phase.delete({
        quoteId: quote.id,
        id: phase,
      })
      await db
        .update(quotes)
        .set({ endDate: "2027-01-31" })
        .where(eq(quotes.id, quote.id))
      await expect(
        c.phase.restore({ quoteId: quote.id, undoToken })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    }))
})

describe("phase.clone", () => {
  it("copies the subtree, its Line Items and Allocations right after the original", () =>
    withTestDb(async (db) => {
      const { organization, caller, quote, product, role } = await setup(db)
      const c = caller("member")
      const a = await createPhase(c, quote.id, "A")
      const a1 = await createPhase(c, quote.id, "A1", a)
      const b = await createPhase(c, quote.id, "B")
      const [productLine] = await addLines(c, quote.id, product.id, a)
      await c.lineItem.update({
        quoteId: quote.id,
        id: productLine!,
        unitPrice: "90",
        notes: "negotiated",
        quantity: "3",
      })
      const roleLine = (
        await c.lineItem.add({
          quoteId: quote.id,
          phaseId: a1,
          items: [{ sourceKind: "resource_role", id: role.id }],
        })
      ).lines[0]!
      await db.insert(allocations).values(
        ["2026-10-01", "2026-11-01"].map((periodStart) => ({
          organizationId: organization.id,
          lineItemId: roleLine.id,
          periodType: "month" as const,
          periodStart,
          amount: "80",
        }))
      )

      const result = await c.phase.clone({ quoteId: quote.id, id: a })
      const copyRoot = result.phases.find((p) => p.name === "Copy of A")!
      const copyChild = result.phases.find((p) => p.name === "A1")!
      expect(copyRoot).toMatchObject({ parentId: null, sequence: 1 })
      expect(copyChild.parentId).toBe(copyRoot.id)
      expect(result.phases.find((p) => p.id === b)).toMatchObject({
        sequence: 2,
      })
      expect(result.lines).toHaveLength(2)
      const copiedProduct = result.lines.find((l) => l.phaseId === copyRoot.id)!
      expect(copiedProduct).toMatchObject({
        name: "Gateway",
        basePrice: "100.0000",
        unitPrice: "90.0000",
        quantity: "3.000",
        notes: "negotiated",
        lineTotal: "270.0000",
      })
      expect(copiedProduct.id).not.toBe(productLine)
      const copiedRole = result.lines.find((l) => l.phaseId === copyChild.id)!
      expect(copiedRole.plannerManaged).toBe(true)
      expect(
        (
          await db
            .select()
            .from(allocations)
            .where(eq(allocations.lineItemId, copiedRole.id))
            .orderBy(allocations.periodStart)
        ).map((a) => [a.periodStart, a.amount])
      ).toEqual([
        ["2026-10-01", "80.000"],
        ["2026-11-01", "80.000"],
      ])
      // The originals are untouched.
      expect((await phaseRows(db, quote.id)).length).toBe(5)
      expect(
        (await lineRows(db, quote.id)).filter((l) => l.phaseId === a)
      ).toHaveLength(1)
    }))
})

describe("lineItem.move", () => {
  it("moves several lines into a Phase before a line, as one command", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db)
      const c = caller("member")
      const phase = await createPhase(c, quote.id, "P")
      const [r1, r2, r3] = await addLines(c, quote.id, product.id, null, 3)
      const [p1, p2] = await addLines(c, quote.id, product.id, phase, 2)

      const result = await c.lineItem.move({
        quoteId: quote.id,
        ids: [r3!, r1!],
        phaseId: phase,
        beforeId: p2,
      })
      // Moved in grid order (r1 before r3), before p2; the Phase is renumbered.
      expect(
        (await lineRows(db, quote.id))
          .filter((l) => l.phaseId === phase)
          .map((l) => l.id)
      ).toEqual([p1, r1, r3, p2])
      expect(result.lines.map((l) => l.id).sort()).toEqual(
        [p1!, r1!, r3!, p2!].sort()
      )

      // Back out of every Phase, at the end.
      await c.lineItem.move({ quoteId: quote.id, ids: [p1!], phaseId: null })
      expect(
        (await lineRows(db, quote.id))
          .filter((l) => l.phaseId === null)
          .map((l) => l.id)
      ).toEqual([r2, p1])
    }))

  it("refuses a beforeId outside the target, another Quote's Phase or line", () =>
    withTestDb(async (db) => {
      const { organization, members, caller, quote, product } = await setup(db)
      const c = caller("member")
      const phase = await createPhase(c, quote.id, "P")
      const [r1, r2] = await addLines(c, quote.id, product.id, null, 2)
      const other = await createQuote(db, organization, {
        owner: members.member.user,
      })
      const otherPhase = await createPhase(c, other.id, "Other")
      const [otherLine] = await addLines(c, other.id, product.id, null)
      await expect(
        c.lineItem.move({
          quoteId: quote.id,
          ids: [r1!],
          phaseId: phase,
          beforeId: r2,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      await expect(
        c.lineItem.move({ quoteId: quote.id, ids: [r1!], phaseId: otherPhase })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(
        c.lineItem.move({
          quoteId: quote.id,
          ids: [r1!, otherLine!],
          phaseId: null,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})

describe("lineItem.clone", () => {
  it("clones in place (right after each original) or into another Phase", () =>
    withTestDb(async (db) => {
      const { caller, quote, product } = await setup(db)
      const c = caller("member")
      const phase = await createPhase(c, quote.id, "P")
      const [a, b] = await addLines(c, quote.id, product.id, null, 2)

      const inPlace = await c.lineItem.clone({ quoteId: quote.id, ids: [a!] })
      const copy = inPlace.lines.find((l) => l.id !== a && l.id !== b)!
      expect(copy).toMatchObject({ name: "Gateway", phaseId: null })
      expect((await lineRows(db, quote.id)).map((l) => l.id)).toEqual([
        a,
        copy.id,
        b,
      ])
      expect(inPlace.totals.subtotal).toBe("300.0000")

      const into = await c.lineItem.clone({
        quoteId: quote.id,
        ids: [b!, a!],
        phaseId: phase,
      })
      expect(into.lines.map((l) => l.phaseId)).toEqual([phase, phase])
      expect(into.totals.subtotal).toBe("500.0000")
      expect(
        (await lineRows(db, quote.id)).filter((l) => l.phaseId === null)
      ).toHaveLength(3)
    }))
})

describe("grid commands and the lock", () => {
  it.each(LOCKED_STAGES)(
    "refuses every Phase and grid command while %s, even for Admins",
    (stage: QuoteStage) =>
      withTestDb(async (db) => {
        const { caller, quote, product } = await setup(db)
        const c = caller("member")
        const phase = await createPhase(c, quote.id, "P")
        const [line] = await addLines(c, quote.id, product.id, phase)
        const gone = await createPhase(c, quote.id, "Gone")
        const { undoToken } = await c.phase.delete({
          quoteId: quote.id,
          id: gone,
        })
        await setQuoteStage(db, quote, stage)
        const before = await editorOrder(c, quote.id)
        const admin = caller("admin")
        const attempts = [
          () => admin.phase.create({ quoteId: quote.id, name: "X" }),
          () => admin.phase.rename({ quoteId: quote.id, id: phase, name: "X" }),
          () =>
            admin.phase.move({ quoteId: quote.id, id: phase, parentId: null }),
          () => admin.phase.delete({ quoteId: quote.id, id: phase }),
          () => admin.phase.restore({ quoteId: quote.id, undoToken }),
          () => admin.phase.clone({ quoteId: quote.id, id: phase }),
          () =>
            admin.lineItem.move({
              quoteId: quote.id,
              ids: [line!],
              phaseId: null,
            }),
          () => admin.lineItem.clone({ quoteId: quote.id, ids: [line!] }),
        ]
        for (const attempt of attempts) {
          await expect(attempt()).rejects.toMatchObject({
            code: "PRECONDITION_FAILED",
          })
        }
        expect(await editorOrder(c, quote.id)).toEqual(before)
      })
  )

  it("refuses a Member who may not edit someone else's Quote", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const phase = await createPhase(caller("member"), quote.id, "P")
      await expect(
        caller("otherMember").phase.rename({
          quoteId: quote.id,
          id: phase,
          name: "X",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
      await expect(
        caller("otherMember").phase.create({ quoteId: quote.id, name: "X" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    }))
})

describe("tenancy isolation", () => {
  it.each([
    "phase.create",
    "phase.rename",
    "phase.move",
    "phase.delete",
    "phase.restore",
    "phase.clone",
    "lineItem.move",
    "lineItem.clone",
  ] as const)("%s is isolated from other Organizations", (procedure) =>
    withTestDb(async (db) => {
      const { organization, caller, quote, product } = await setup(db)
      const c = caller("member")
      const phase = await createPhase(c, quote.id, "P")
      const [line] = await addLines(c, quote.id, product.id, phase)
      const gone = await createPhase(c, quote.id, "Gone")
      const { undoToken } = await c.phase.delete({
        quoteId: quote.id,
        id: gone,
      })
      const snapshot = async () => ({
        quote: await quoteRow(db, quote.id),
        phases: await phaseRows(db, quote.id),
        lines: await lineRows(db, quote.id),
      })
      await expectIsolated(db, {
        owner: organization,
        call: (x) => {
          switch (procedure) {
            case "phase.create":
              return x.phase.create({ quoteId: quote.id, name: "Hacked" })
            case "phase.rename":
              return x.phase.rename({
                quoteId: quote.id,
                id: phase,
                name: "Hacked",
              })
            case "phase.move":
              return x.phase.move({
                quoteId: quote.id,
                id: phase,
                parentId: null,
              })
            case "phase.delete":
              return x.phase.delete({ quoteId: quote.id, id: phase })
            case "phase.restore":
              return x.phase.restore({ quoteId: quote.id, undoToken })
            case "phase.clone":
              return x.phase.clone({ quoteId: quote.id, id: phase })
            case "lineItem.move":
              return x.lineItem.move({
                quoteId: quote.id,
                ids: [line!],
                phaseId: null,
              })
            case "lineItem.clone":
              return x.lineItem.clone({ quoteId: quote.id, ids: [line!] })
          }
        },
        snapshot,
      })
    })
  )
})
