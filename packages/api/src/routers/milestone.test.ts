import { describe, expect, it } from "vitest"

import { asc, eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import type { QuoteStage } from "@workspace/domain/enums"
import { LOCKED_STAGES } from "@workspace/domain/stages"

import {
  createMember,
  createOrganization,
  createQuote,
  expectIsolated,
  organizationCaller,
  setQuoteStage,
  withTestDb,
} from "../test"

const { milestones, quotes } = schema

/** An Organization, a Member's Draft Quote, another Member and an Admin. */
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
  return { organization, members, caller, quote }
}

const milestoneRows = (db: Db, quoteId: string) =>
  db
    .select()
    .from(milestones)
    .where(eq(milestones.quoteId, quoteId))
    .orderBy(asc(milestones.date), asc(milestones.id))

describe("milestone.create / update", () => {
  it("creates with the type's colour and returns the editor result", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const result = await caller("member").milestone.create({
        quoteId: quote.id,
        name: "  Kick-off ",
        date: "2026-10-05",
        type: "review",
      })
      expect(result).toMatchObject({
        quoteId: quote.id,
        lines: [],
        phases: [],
        deletedMilestoneIds: [],
        milestones: [
          {
            name: "Kick-off",
            date: "2026-10-05",
            type: "review",
            colour: "#7c3aed",
            completed: false,
            description: null,
            quoteId: quote.id,
          },
        ],
      })
      const editor = await caller("otherMember").quote.editor({ id: quote.id })
      expect(editor.milestones.map((m) => m.name)).toEqual(["Kick-off"])
    }))

  it("updates only the given fields and orders the editor by date", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const c = caller("member")
      const first = (
        await c.milestone.create({
          quoteId: quote.id,
          name: "Go-live",
          date: "2026-12-15",
          type: "deadline",
          colour: "#ABC",
          description: "Cut-over weekend",
        })
      ).milestones[0]!
      expect(first.colour).toBe("#aabbcc")
      await c.milestone.create({
        quoteId: quote.id,
        name: "Deposit",
        date: "2026-10-01",
        type: "payment_due",
      })

      const updated = await c.milestone.update({
        quoteId: quote.id,
        id: first.id,
        completed: true,
        date: "2026-12-20",
      })
      expect(updated.milestones[0]).toMatchObject({
        id: first.id,
        name: "Go-live",
        type: "deadline",
        colour: "#aabbcc",
        description: "Cut-over weekend",
        completed: true,
        date: "2026-12-20",
      })
      await c.milestone.update({
        quoteId: quote.id,
        id: first.id,
        description: "",
      })
      const editor = await c.quote.editor({ id: quote.id })
      expect(editor.milestones.map((m) => [m.name, m.description])).toEqual([
        ["Deposit", null],
        ["Go-live", null],
      ])
    }))

  it("refuses bad input and another Quote's Milestone", () =>
    withTestDb(async (db) => {
      const { organization, members, caller, quote } = await setup(db)
      const c = caller("member")
      await expect(
        c.milestone.create({
          quoteId: quote.id,
          name: "X",
          date: "2026-10-01",
          colour: "blue",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      await expect(
        c.milestone.create({ quoteId: quote.id, name: " ", date: "2026-10-01" })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      await expect(
        c.milestone.create({ quoteId: quote.id, name: "X", date: "2026-13-01" })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      const other = await createQuote(db, organization, {
        owner: members.member.user,
      })
      const foreign = (
        await c.milestone.create({
          quoteId: other.id,
          name: "Other",
          date: "2026-10-01",
        })
      ).milestones[0]!
      await expect(
        c.milestone.update({ quoteId: quote.id, id: foreign.id, name: "X" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(
        c.milestone.delete({ quoteId: quote.id, id: foreign.id })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})

describe("milestone.delete / restore", () => {
  it("deletes with an undo that restores the same Milestone once", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const c = caller("member")
      const created = (
        await c.milestone.create({
          quoteId: quote.id,
          name: "Review",
          date: "2026-11-02",
          type: "review",
          completed: true,
          description: "Steering committee",
        })
      ).milestones[0]!
      const deleted = await c.milestone.delete({
        quoteId: quote.id,
        id: created.id,
      })
      expect(deleted.deletedMilestoneIds).toEqual([created.id])
      expect(await milestoneRows(db, quote.id)).toEqual([])

      const restored = await c.milestone.restore({
        quoteId: quote.id,
        undoToken: deleted.undoToken,
      })
      expect(restored.milestones[0]).toMatchObject({
        id: created.id,
        name: "Review",
        date: "2026-11-02",
        type: "review",
        colour: created.colour,
        completed: true,
        description: "Steering committee",
      })
      await expect(
        c.milestone.restore({ quoteId: quote.id, undoToken: deleted.undoToken })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("goes with its Quote", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      await caller("member").milestone.create({
        quoteId: quote.id,
        name: "M",
        date: "2026-10-01",
      })
      await db.delete(quotes).where(eq(quotes.id, quote.id))
      expect(await milestoneRows(db, quote.id)).toEqual([])
    }))
})

describe("Milestones and the lock", () => {
  it.each(LOCKED_STAGES)(
    "refuses every Milestone command while %s, even for Admins",
    (stage: QuoteStage) =>
      withTestDb(async (db) => {
        const { caller, quote } = await setup(db)
        const c = caller("member")
        const kept = (
          await c.milestone.create({
            quoteId: quote.id,
            name: "Kept",
            date: "2026-10-01",
          })
        ).milestones[0]!
        const gone = (
          await c.milestone.create({
            quoteId: quote.id,
            name: "Gone",
            date: "2026-10-02",
          })
        ).milestones[0]!
        const { undoToken } = await c.milestone.delete({
          quoteId: quote.id,
          id: gone.id,
        })
        await setQuoteStage(db, quote, stage)
        const before = await milestoneRows(db, quote.id)
        const admin = caller("admin")
        const attempts = [
          () =>
            admin.milestone.create({
              quoteId: quote.id,
              name: "X",
              date: "2026-10-01",
            }),
          () =>
            admin.milestone.update({
              quoteId: quote.id,
              id: kept.id,
              completed: true,
            }),
          () => admin.milestone.delete({ quoteId: quote.id, id: kept.id }),
          () => admin.milestone.restore({ quoteId: quote.id, undoToken }),
        ]
        for (const attempt of attempts) {
          await expect(attempt()).rejects.toMatchObject({
            code: "PRECONDITION_FAILED",
          })
        }
        expect(await milestoneRows(db, quote.id)).toEqual(before)
      })
  )

  it("refuses a Member who may not edit someone else's Quote", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      await expect(
        caller("otherMember").milestone.create({
          quoteId: quote.id,
          name: "X",
          date: "2026-10-01",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    }))
})

describe("tenancy isolation", () => {
  it.each([
    "milestone.create",
    "milestone.update",
    "milestone.delete",
    "milestone.restore",
  ] as const)("%s is isolated from other Organizations", (procedure) =>
    withTestDb(async (db) => {
      const { organization, caller, quote } = await setup(db)
      const c = caller("member")
      const kept = (
        await c.milestone.create({
          quoteId: quote.id,
          name: "Kept",
          date: "2026-10-01",
        })
      ).milestones[0]!
      const gone = (
        await c.milestone.create({
          quoteId: quote.id,
          name: "Gone",
          date: "2026-10-02",
        })
      ).milestones[0]!
      const { undoToken } = await c.milestone.delete({
        quoteId: quote.id,
        id: gone.id,
      })
      await expectIsolated(db, {
        owner: organization,
        call: (x) => {
          switch (procedure) {
            case "milestone.create":
              return x.milestone.create({
                quoteId: quote.id,
                name: "Hacked",
                date: "2026-10-01",
              })
            case "milestone.update":
              return x.milestone.update({
                quoteId: quote.id,
                id: kept.id,
                name: "Hacked",
              })
            case "milestone.delete":
              return x.milestone.delete({ quoteId: quote.id, id: kept.id })
            case "milestone.restore":
              return x.milestone.restore({ quoteId: quote.id, undoToken })
          }
        },
        snapshot: () => milestoneRows(db, quote.id),
      })
    })
  )
})
