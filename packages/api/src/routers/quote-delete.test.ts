import { describe, expect, it } from "vitest"

import { eq, inArray, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import { QUOTE_STAGES } from "@workspace/domain/enums"

import {
  createApprovalStep,
  createMember,
  createMemoryStorage,
  createOrganization,
  createQuote,
  createResourceRole,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const {
  allocations,
  approvalSteps,
  costChangeLog,
  lineItems,
  milestones,
  phases,
  quoteDocuments,
  quotes,
  undoSnapshots,
} = schema

/**
 * An Organization with an Admin, a Manager and two Members; the first
 * Member owns a Draft Quote.
 */
async function setup(db: Db) {
  const organization = await createOrganization(db)
  const members = {
    admin: await createMember(db, organization, { role: "admin" }),
    manager: await createMember(db, organization, { role: "manager" }),
    member: await createMember(db, organization, { role: "member" }),
    otherMember: await createMember(db, organization, { role: "member" }),
  }
  const caller = (who: keyof typeof members) =>
    organizationCaller(db, { organization, user: members[who].user })
  const quote = await createQuote(db, organization, {
    owner: members.member.user,
    name: "Initech rollout",
  })
  return { organization, members, caller, quote }
}

const quoteExists = async (db: Db, id: string) =>
  (await db.select().from(quotes).where(eq(quotes.id, id))).length > 0

/** Gives `quote` a Phase, a planned line, a Milestone and an undo snapshot. */
async function fillQuote(
  db: Db,
  organization: { id: string },
  caller: ReturnType<typeof organizationCaller>,
  quoteId: string
) {
  const role = await createResourceRole(db, organization)
  const phaseId = (await caller.phase.create({ quoteId, name: "Build" }))
    .phases[0]!.id
  const lines = (
    await caller.lineItem.add({
      quoteId,
      phaseId,
      items: [
        { sourceKind: "resource_role", id: role.id },
        { sourceKind: "resource_role", id: role.id },
      ],
    })
  ).lines
  await caller.allocation.setRange({
    quoteId,
    cells: [
      { lineItemId: lines[0]!.id, periodStart: "2026-10-01", amount: "10" },
    ],
  })
  await caller.milestone.create({
    quoteId,
    name: "Go-live",
    date: "2026-12-01",
  })
  await caller.lineItem.delete({ quoteId, ids: [lines[1]!.id] })
}

/** Rows of every child table that belong to `quoteId`. */
async function children(db: Db, quoteId: string) {
  const lines = await db
    .select({ id: lineItems.id })
    .from(lineItems)
    .where(eq(lineItems.quoteId, quoteId))
  return {
    phases: (await db.select().from(phases).where(eq(phases.quoteId, quoteId)))
      .length,
    lineItems: lines.length,
    allocations: lines.length
      ? (
          await db
            .select()
            .from(allocations)
            .where(
              inArray(
                allocations.lineItemId,
                lines.map((l) => l.id)
              )
            )
        ).length
      : 0,
    milestones: (
      await db.select().from(milestones).where(eq(milestones.quoteId, quoteId))
    ).length,
    undoSnapshots: (
      await db
        .select()
        .from(undoSnapshots)
        .where(eq(undoSnapshots.quoteId, quoteId))
    ).length,
  }
}

describe("quote.delete", () => {
  it("lets the Owner delete a Draft, cascading to every child row", () =>
    withTestDb(async (db) => {
      const { organization, caller, quote, members } = await setup(db)
      await fillQuote(db, organization, caller("member"), quote.id)
      const other = await createQuote(db, organization, {
        owner: members.member.user,
      })
      await fillQuote(db, organization, caller("member"), other.id)
      expect(await children(db, quote.id)).toEqual({
        phases: 1,
        lineItems: 1,
        allocations: 3,
        milestones: 1,
        undoSnapshots: 2, // the Planner gesture and the line delete
      })

      expect(await caller("member").quote.delete({ id: quote.id })).toEqual({
        id: quote.id,
        name: "Initech rollout",
      })
      expect(await quoteExists(db, quote.id)).toBe(false)
      expect(await children(db, quote.id)).toEqual({
        phases: 0,
        lineItems: 0,
        allocations: 0,
        milestones: 0,
        undoSnapshots: 0,
      })
      // Other Quotes keep theirs.
      expect((await children(db, other.id)).lineItems).toBe(1)

      await expect(
        caller("member").quote.byId({ id: quote.id })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(
        caller("member").quote.delete({ id: quote.id })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("removes its Quote Documents' files, Approval Steps and cost log entries", () =>
    withTestDb(async (db) => {
      const { organization, members, quote } = await setup(db)
      const storage = createMemoryStorage()
      const owner = organizationCaller(db, {
        organization,
        user: members.member.user,
        storage,
      })
      await fillQuote(db, organization, owner, quote.id)
      const other = await createQuote(db, organization, {
        owner: members.member.user,
      })
      await fillQuote(db, organization, owner, other.id)

      const docs = [
        await owner.quoteDocument.generate({ quoteId: quote.id }),
        await owner.quoteDocument.generate({ quoteId: quote.id }),
      ]
      const kept = await owner.quoteDocument.generate({ quoteId: other.id })
      // Two Approval Steps (submit, recall) leave it in Draft again.
      await owner.quote.submit({ id: quote.id })
      await owner.quote.recall({ id: quote.id })
      // A cost change on a Draft writes cost log entries for both Quotes.
      const [line] = await db
        .select()
        .from(lineItems)
        .where(eq(lineItems.quoteId, quote.id))
      await organizationCaller(db, {
        organization,
        user: members.admin.user,
      }).resourceRole.update({ id: line!.resourceRoleId!, costRate: "77" })

      const rowsOf = async (quoteId: string) => ({
        documents: (
          await db
            .select()
            .from(quoteDocuments)
            .where(eq(quoteDocuments.quoteId, quoteId))
        ).length,
        approvalSteps: (
          await db
            .select()
            .from(approvalSteps)
            .where(eq(approvalSteps.quoteId, quoteId))
        ).length,
        costChangeLog: (
          await db
            .select()
            .from(costChangeLog)
            .where(eq(costChangeLog.quoteId, quoteId))
        ).length,
      })
      expect(await rowsOf(quote.id)).toEqual({
        documents: 2,
        approvalSteps: 2,
        costChangeLog: 1,
      })
      const keys = (
        await db
          .select({ key: quoteDocuments.storageKey })
          .from(quoteDocuments)
          .where(eq(quoteDocuments.quoteId, quote.id))
      ).map((r) => r.key)
      for (const key of keys) expect(storage.objects.has(key)).toBe(true)
      expect(docs).toHaveLength(2)

      await owner.quote.delete({ id: quote.id })

      expect(await rowsOf(quote.id)).toEqual({
        documents: 0,
        approvalSteps: 0,
        costChangeLog: 0,
      })
      for (const key of keys) expect(storage.objects.has(key)).toBe(false)
      // The other Quote's Document and its file stay.
      const [otherDoc] = await db
        .select()
        .from(quoteDocuments)
        .where(eq(quoteDocuments.id, kept.id))
      expect(otherDoc).toBeDefined()
      expect(storage.objects.has(otherDoc!.storageKey)).toBe(true)
    }))

  it("allows only the Owner or an Admin", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      for (const who of ["otherMember", "manager"] as const) {
        await expect(
          caller(who).quote.delete({ id: quote.id })
        ).rejects.toMatchObject({ code: "FORBIDDEN" })
      }
      expect(await quoteExists(db, quote.id)).toBe(true)
      await caller("admin").quote.delete({ id: quote.id })
      expect(await quoteExists(db, quote.id)).toBe(false)
    }))

  it("still lets an Admin delete a removed member's Quote", () =>
    withTestDb(async (db) => {
      const { caller, quote, members } = await setup(db)
      await db
        .delete(schema.memberships)
        .where(eq(schema.memberships.id, members.member.membership.id))
      await caller("admin").quote.delete({ id: quote.id })
      expect(await quoteExists(db, quote.id)).toBe(false)
    }))

  it("deletes only in the default deletable Stages (Draft; not Lost)", () =>
    withTestDb(async (db) => {
      const { organization, caller, members } = await setup(db)
      for (const stage of QUOTE_STAGES) {
        const quote = await createQuote(db, organization, {
          owner: members.admin.user,
          stage,
        })
        const attempt = caller("admin").quote.delete({ id: quote.id })
        if (stage === "draft") {
          await attempt
          expect(await quoteExists(db, quote.id), stage).toBe(false)
        } else {
          await expect(attempt, stage).rejects.toMatchObject({
            code: "PRECONDITION_FAILED",
            message: "Quotes can't be deleted in this Stage.",
          })
          expect(await quoteExists(db, quote.id), stage).toBe(true)
        }
      }
    }))

  it("deletes a Rejected Draft like any Draft", () =>
    withTestDb(async (db) => {
      const { caller, quote, members } = await setup(db)
      await createApprovalStep(db, quote, {
        action: "reject",
        actor: members.admin.user,
      })
      await caller("member").quote.delete({ id: quote.id })
      expect(await quoteExists(db, quote.id)).toBe(false)
    }))

  it("follows the Organization's per-Stage deletable setting", () =>
    withTestDb(async (db) => {
      const { organization, caller, quote, members } = await setup(db)
      await caller("admin").settings.updateQuoting({
        hoursPerDay: "8",
        deletableStages: ["lost"],
      })
      await expect(
        caller("member").quote.delete({ id: quote.id })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      const lost = await createQuote(db, organization, {
        owner: members.member.user,
        stage: "lost",
      })
      await caller("member").quote.delete({ id: lost.id })
      expect(await quoteExists(db, lost.id)).toBe(false)
      // Both on: Draft and Lost.
      await caller("admin").settings.updateQuoting({
        hoursPerDay: "8",
        deletableStages: ["draft", "lost"],
      })
      await caller("member").quote.delete({ id: quote.id })
      expect(await quoteExists(db, quote.id)).toBe(false)
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.quote.delete({ id: quote.id }),
        snapshot: () => db.select().from(quotes).where(eq(quotes.id, quote.id)),
      })
    }))
})

describe("quote.deleteMany", () => {
  it("deletes what the caller may and reports the rest as skipped", () =>
    withTestDb(async (db) => {
      const { organization, caller, members, quote } = await setup(db)
      const approved = await createQuote(db, organization, {
        owner: members.member.user,
        name: "Signed deal",
        stage: "approved",
      })
      const someoneElses = await createQuote(db, organization, {
        owner: members.otherMember.user,
        name: "Not mine",
      })
      const rejected = await createQuote(db, organization, {
        owner: members.member.user,
        name: "Lost",
      })
      await createApprovalStep(db, rejected, {
        action: "reject",
        actor: members.admin.user,
      })

      const result = await caller("member").quote.deleteMany({
        ids: [quote.id, approved.id, someoneElses.id, rejected.id, quote.id],
      })
      expect(result.deleted).toEqual([
        { id: quote.id, name: "Initech rollout" },
        { id: rejected.id, name: "Lost" },
      ])
      expect(result.skipped).toEqual([
        {
          id: approved.id,
          name: "Signed deal",
          reason: "Quotes can't be deleted in this Stage.",
        },
        {
          id: someoneElses.id,
          name: "Not mine",
          reason: "Only the Quote Owner or an Admin can delete this Quote.",
        },
      ])
      expect(await quoteExists(db, quote.id)).toBe(false)
      expect(await quoteExists(db, rejected.id)).toBe(false)
      expect(await quoteExists(db, approved.id)).toBe(true)
      expect(await quoteExists(db, someoneElses.id)).toBe(true)

      // An Admin may delete someone else's.
      const admin = await caller("admin").quote.deleteMany({
        ids: [someoneElses.id],
      })
      expect(admin).toEqual({
        deleted: [{ id: someoneElses.id, name: "Not mine" }],
        skipped: [],
      })
    }))

  it("refuses the whole call when an id isn't this Organization's Quote", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const other = await createOrganization(db)
      const { user } = await createMember(db, other)
      const foreign = await createQuote(db, other, { owner: user })
      await expect(
        caller("member").quote.deleteMany({ ids: [quote.id, foreign.id] })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      expect(await quoteExists(db, quote.id)).toBe(true)
      expect(await quoteExists(db, foreign.id)).toBe(true)
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.quote.deleteMany({ ids: [quote.id] }),
        snapshot: () => db.select().from(quotes).where(eq(quotes.id, quote.id)),
      })
    }))
})

describe("quote.list canDelete", () => {
  it("says which rows the caller may delete", () =>
    withTestDb(async (db) => {
      const { organization, caller, members, quote } = await setup(db)
      const approved = await createQuote(db, organization, {
        owner: members.member.user,
        stage: "approved",
      })
      const someoneElses = await createQuote(db, organization, {
        owner: members.otherMember.user,
      })
      const canDelete = async (who: "member" | "admin") =>
        Object.fromEntries(
          (await caller(who).quote.list({})).rows.map((r) => [
            r.id,
            r.canDelete,
          ])
        )
      expect(await canDelete("member")).toEqual({
        [quote.id]: true,
        [approved.id]: false,
        [someoneElses.id]: false,
      })
      expect(await canDelete("admin")).toEqual({
        [quote.id]: true,
        [approved.id]: false,
        [someoneElses.id]: true,
      })
    }))
})
