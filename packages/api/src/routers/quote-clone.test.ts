import { describe, expect, it } from "vitest"

import { asc, eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"

import {
  createAccount,
  createCatalogItem,
  createMember,
  createOrganization,
  createQuote,
  createResourceRole,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const { allocations, catalogItems, lineItems, milestones, phases, quotes } =
  schema

/**
 * An Organization with a Member who owns a Draft Quote (Oct–Dec 2026,
 * Months) built through the API: a Phase tree (Build › Backend, and Run),
 * a Product line in Backend at a negotiated price, a Resource Role line in
 * Build with Allocations, a Phase-less Product line, a completed Milestone
 * and a 10 % Quote Discount. Another Member and an Admin too.
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
  const account = await createAccount(db, organization, { name: "Initech" })
  const quote = await createQuote(db, organization, {
    owner: members.member.user,
    account,
    name: "Initech rollout",
    description: "Phase one",
    validUntil: "2026-09-30",
  })
  const product = await createCatalogItem(db, organization, {
    name: "Gateway",
    price: "100",
    cost: "60",
  })
  const addOn = await createCatalogItem(db, organization, {
    kind: "add_on",
    name: "Support",
    price: "20",
    cost: "5",
  })
  const role = await createResourceRole(db, organization, {
    name: "Architect",
    billRate: "150",
    costRate: "100",
  })

  const owner = caller("member")
  const build = (await owner.phase.create({ quoteId: quote.id, name: "Build" }))
    .phases[0]!.id
  const backend = (
    await owner.phase.create({
      quoteId: quote.id,
      name: "Backend",
      parentId: build,
    })
  ).phases[0]!.id
  await owner.phase.create({ quoteId: quote.id, name: "Run" })
  const [productLine] = (
    await owner.lineItem.add({
      quoteId: quote.id,
      phaseId: backend,
      items: [{ sourceKind: "product", id: product.id }],
    })
  ).lines
  await owner.lineItem.update({
    quoteId: quote.id,
    id: productLine!.id,
    quantity: "3",
    unitPrice: "90",
  })
  const [roleLine] = (
    await owner.lineItem.add({
      quoteId: quote.id,
      phaseId: build,
      items: [{ sourceKind: "resource_role", id: role.id }],
    })
  ).lines
  await owner.allocation.setRange({
    quoteId: quote.id,
    cells: [
      { lineItemId: roleLine!.id, periodStart: "2026-10-01", amount: "40" },
      { lineItemId: roleLine!.id, periodStart: "2026-11-01", amount: "60" },
    ],
  })
  await owner.lineItem.add({
    quoteId: quote.id,
    items: [{ sourceKind: "add_on", id: addOn.id }],
  })
  await owner.milestone.create({
    quoteId: quote.id,
    name: "Go-live",
    date: "2026-12-15",
    type: "review",
    completed: true,
    description: "Launch",
  })
  await owner.quote.setDiscount({
    id: quote.id,
    discount: { kind: "percent", value: "10" },
  })
  return {
    organization,
    members,
    caller,
    account,
    quote,
    product,
    addOn,
    role,
  }
}

const quoteRow = async (db: Db, id: string) =>
  (await db.select().from(quotes).where(eq(quotes.id, id)))[0]!

/** A Quote's Phases as `path` names (e.g. "Build › Backend"), with sequence. */
async function phaseTree(db: Db, quoteId: string) {
  const rows = await db
    .select()
    .from(phases)
    .where(eq(phases.quoteId, quoteId))
    .orderBy(asc(phases.name))
  const byId = new Map(rows.map((p) => [p.id, p]))
  const path = (id: string | null): string => {
    if (!id) return ""
    const p = byId.get(id)!
    return p.parentId ? `${path(p.parentId)} › ${p.name}` : p.name
  }
  return {
    rows,
    path,
    shape: rows.map((p) => ({ path: path(p.id), sequence: p.sequence })),
  }
}

/** A Quote's lines, comparable across Quotes (ids and Phases as paths). */
async function lineShape(db: Db, quoteId: string) {
  const tree = await phaseTree(db, quoteId)
  const rows = await db
    .select()
    .from(lineItems)
    .where(eq(lineItems.quoteId, quoteId))
    .orderBy(asc(lineItems.sequence), asc(lineItems.id))
  const allocs = await db
    .select()
    .from(allocations)
    .orderBy(asc(allocations.periodStart))
  return rows.map((l) => ({
    phase: tree.path(l.phaseId),
    sourceKind: l.sourceKind,
    catalogItemId: l.catalogItemId,
    resourceRoleId: l.resourceRoleId,
    name: l.name,
    startDate: l.startDate,
    endDate: l.endDate,
    billingUnit: l.billingUnit,
    basePrice: l.basePrice,
    baseCost: l.baseCost,
    unitPrice: l.unitPrice,
    unitCost: l.unitCost,
    quantity: l.quantity,
    lineTotal: l.lineTotal,
    lineMarginPct: l.lineMarginPct,
    sequence: l.sequence,
    allocations: allocs
      .filter((a) => a.lineItemId === l.id)
      .map((a) => ({
        periodType: a.periodType,
        periodStart: a.periodStart,
        amount: a.amount,
      })),
  }))
}

const MONEY_FIELDS = [
  "currencyCode",
  "discountKind",
  "discountValue",
  "subtotal",
  "discountAmount",
  "total",
  "cost",
  "margin",
  "marginPct",
] as const

describe("quote.clone", () => {
  it("copies the Phase tree, lines, Allocations, Milestones and Discount into a Draft the cloner owns", () =>
    withTestDb(async (db) => {
      const { caller, members, quote, account } = await setup(db)
      // Committed and someone else's: still clonable by any member.
      await db
        .update(quotes)
        .set({ status: "approved" })
        .where(eq(quotes.id, quote.id))

      const result = await caller("otherMember").quote.clone({ id: quote.id })
      expect(result.name).toBe("Copy of Initech rollout")
      expect(result.id).not.toBe(quote.id)

      const source = await quoteRow(db, quote.id)
      const clone = await quoteRow(db, result.id)
      expect(clone).toMatchObject({
        name: "Copy of Initech rollout",
        status: "draft",
        accountId: account.id,
        ownerId: members.otherMember.user.id,
        createdById: members.otherMember.user.id,
        updatedById: members.otherMember.user.id,
        description: "Phase one",
        startDate: source.startDate,
        endDate: source.endDate,
        validUntil: source.validUntil,
        timePeriod: source.timePeriod,
      })
      for (const field of MONEY_FIELDS) {
        expect(clone[field], field).toEqual(source[field])
      }
      expect(Number(clone.total)).toBeGreaterThan(0)

      // Phase tree with remapped parents: none point into the source.
      const sourceTree = await phaseTree(db, quote.id)
      const cloneTree = await phaseTree(db, result.id)
      expect(cloneTree.shape).toEqual(sourceTree.shape)
      expect(cloneTree.shape.map((p) => p.path)).toContain("Build › Backend")
      const cloneIds = new Set(cloneTree.rows.map((p) => p.id))
      for (const p of cloneTree.rows) {
        if (p.parentId) expect(cloneIds.has(p.parentId)).toBe(true)
        expect(sourceTree.rows.some((s) => s.id === p.id)).toBe(false)
      }

      // Lines (Base Rates, negotiated price, quantities) and Allocations.
      const lines = await lineShape(db, result.id)
      expect(lines).toEqual(await lineShape(db, quote.id))
      expect(lines).toHaveLength(3)
      expect(lines.find((l) => l.name === "Architect")!.allocations).toEqual([
        { periodType: "month", periodStart: "2026-10-01", amount: "40.000" },
        { periodType: "month", periodStart: "2026-11-01", amount: "60.000" },
        // December kept the Planner's default layout.
        { periodType: "month", periodStart: "2026-12-01", amount: "56.000" },
      ])

      // Milestones, completed reset.
      const cloned = await db
        .select()
        .from(milestones)
        .where(eq(milestones.quoteId, result.id))
      expect(cloned).toEqual([
        expect.objectContaining({
          name: "Go-live",
          date: "2026-12-15",
          type: "review",
          completed: false,
          description: "Launch",
        }),
      ])

      // The editor reads the clone like any Quote.
      const editor = await caller("otherMember").quote.editor({
        id: result.id,
      })
      expect(editor.totals.total).toBe(source.total)

      // The source is untouched.
      expect(await quoteRow(db, quote.id)).toEqual(source)
    }))

  it("clones for another Account, and refuses an archived or unknown one", () =>
    withTestDb(async (db) => {
      const { caller, organization, quote } = await setup(db)
      const globex = await createAccount(db, organization, { name: "Globex" })
      const { id } = await caller("admin").quote.clone({
        id: quote.id,
        accountId: globex.id,
      })
      expect((await quoteRow(db, id)).accountId).toBe(globex.id)

      const archived = await createAccount(db, organization, {
        name: "Hooli",
        archived: true,
      })
      await expect(
        caller("admin").quote.clone({ id: quote.id, accountId: archived.id })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })

      const other = await createOrganization(db)
      const foreign = await createAccount(db, other)
      await expect(
        caller("admin").quote.clone({ id: quote.id, accountId: foreign.id })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("refuses when the source's own Account is archived and no other is given", () =>
    withTestDb(async (db) => {
      const { caller, quote, account } = await setup(db)
      await db
        .update(schema.accounts)
        .set({ archived: true })
        .where(eq(schema.accounts.id, account.id))
      await expect(
        caller("member").quote.clone({ id: quote.id })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    }))

  it("keeps Base Rates by default even after catalog changes", () =>
    withTestDb(async (db) => {
      const { caller, quote, product, role } = await setup(db)
      await db
        .update(catalogItems)
        .set({ price: "200", cost: "120" })
        .where(eq(catalogItems.id, product.id))
      await db
        .update(schema.resourceRoles)
        .set({ billRate: "300", costRate: "180" })
        .where(eq(schema.resourceRoles.id, role.id))
      const { id } = await caller("member").quote.clone({ id: quote.id })
      expect(await lineShape(db, id)).toEqual(await lineShape(db, quote.id))
    }))

  it("re-snapshots price and cost from the catalog on request; inactive sources keep their snapshot", () =>
    withTestDb(async (db) => {
      const { caller, quote, product, addOn, role } = await setup(db)
      await db
        .update(catalogItems)
        .set({ price: "200", cost: "120" })
        .where(eq(catalogItems.id, product.id))
      await db
        .update(schema.resourceRoles)
        .set({ billRate: "300", costRate: "180" })
        .where(eq(schema.resourceRoles.id, role.id))
      // Inactive: its new rates must not reach the clone.
      await db
        .update(catalogItems)
        .set({ price: "99", cost: "98", active: false })
        .where(eq(catalogItems.id, addOn.id))

      const { id } = await caller("member").quote.clone({
        id: quote.id,
        refreshRates: true,
      })
      const byName = new Map((await lineShape(db, id)).map((l) => [l.name, l]))
      // Architect followed its Base Rate, so its unit rates move too;
      // quantity and Allocations stay.
      expect(byName.get("Architect")).toMatchObject({
        basePrice: "300.0000",
        baseCost: "180.0000",
        unitPrice: "300.0000",
        unitCost: "180.0000",
        quantity: "156.000",
        lineTotal: "46800.0000",
      })
      // Gateway's negotiated price (90) is kept; its Base Rate and cost move.
      expect(byName.get("Gateway")).toMatchObject({
        basePrice: "200.0000",
        baseCost: "120.0000",
        unitPrice: "90.0000",
        unitCost: "120.0000",
        lineTotal: "270.0000",
      })
      expect(byName.get("Support")).toMatchObject({
        basePrice: "20.0000",
        baseCost: "5.0000",
        unitPrice: "20.0000",
        unitCost: "5.0000",
      })

      // Totals are repriced from the refreshed lines (10 % off).
      const clone = await quoteRow(db, id)
      const support = byName.get("Support")!
      const subtotal = 46800 + 270 + Number(support.lineTotal)
      expect(Number(clone.subtotal)).toBe(subtotal)
      expect(Number(clone.total)).toBeCloseTo(subtotal * 0.9, 4)
    }))

  it("never copies undo snapshots or anything but the listed children", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      // A delete leaves an undo snapshot on the source.
      const lines = await db
        .select()
        .from(lineItems)
        .where(eq(lineItems.quoteId, quote.id))
      await caller("member").lineItem.delete({
        quoteId: quote.id,
        ids: [lines[0]!.id],
      })
      const { id } = await caller("member").quote.clone({ id: quote.id })
      const snapshots = await db
        .select()
        .from(schema.undoSnapshots)
        .where(eq(schema.undoSnapshots.quoteId, id))
      expect(snapshots).toEqual([])
    }))

  it("never copies Approval Steps, Quote Documents or cost log entries", () =>
    withTestDb(async (db) => {
      const { caller, quote, role } = await setup(db)
      const owner = caller("member")
      await owner.quoteDocument.generate({ quoteId: quote.id })
      await owner.quote.submit({ id: quote.id })
      await owner.quote.recall({ id: quote.id })
      await caller("admin").resourceRole.update({
        id: role.id,
        costRate: "90",
      })
      const countOf = async (
        table:
          | typeof schema.approvalSteps
          | typeof schema.quoteDocuments
          | typeof schema.costChangeLog,
        quoteId: string
      ) =>
        (await db.select().from(table).where(eq(table.quoteId, quoteId))).length
      expect(await countOf(schema.approvalSteps, quote.id)).toBe(2)
      expect(await countOf(schema.quoteDocuments, quote.id)).toBe(1)
      expect(await countOf(schema.costChangeLog, quote.id)).toBe(1)

      const { id } = await caller("otherMember").quote.clone({ id: quote.id })
      expect(await countOf(schema.approvalSteps, id)).toBe(0)
      expect(await countOf(schema.quoteDocuments, id)).toBe(0)
      expect(await countOf(schema.costChangeLog, id)).toBe(0)
      // The cost change reached the source's Draft lines; the clone copies them.
      const architect = (await lineShape(db, id)).find(
        (l) => l.name === "Architect"
      )
      expect(architect?.baseCost).toBe("90.0000")
    }))

  it("clones an empty Quote", () =>
    withTestDb(async (db) => {
      const organization = await createOrganization(db)
      const { user } = await createMember(db, organization)
      const quote = await createQuote(db, organization, {
        owner: user,
        name: "x".repeat(200),
      })
      const { id, name } = await organizationCaller(db, {
        organization,
        user,
      }).quote.clone({ id: quote.id })
      expect(name).toHaveLength(200)
      expect(name.startsWith("Copy of x")).toBe(true)
      expect(await quoteRow(db, id)).toMatchObject({ total: "0.0000" })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.quote.clone({ id: quote.id }),
        snapshot: () =>
          db
            .select({ id: quotes.id })
            .from(quotes)
            .where(eq(quotes.organizationId, organization.id)),
      })
    }))
})
