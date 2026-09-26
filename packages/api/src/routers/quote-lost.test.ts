/**
 * The Lost Stage (#32): Mark as Lost (who, from which Stages, the required
 * reason, the mark_lost step), an Admin's reopen (Lost → Draft, not
 * Rejected), Won's immutability, Lost Quotes outside the open pipeline and
 * the Key Insights, and isolation.
 */
import { describe, expect, it } from "vitest"

import { asc, eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import type { QuoteStage } from "@workspace/domain/enums"

import {
  createApprovalStep,
  createMember,
  createOrganization,
  createQuote,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const { approvalSteps, quotes } = schema

/**
 * An Organization whose Member owns a Quote (Draft by default, positive
 * Total), plus an Admin, a Manager, another Member and an Approver.
 */
async function setup(db: Db, stage: QuoteStage = "draft") {
  const organization = await createOrganization(db)
  const members = {
    owner: await createMember(db, organization, { role: "member" }),
    admin: await createMember(db, organization, { role: "admin" }),
    manager: await createMember(db, organization, { role: "manager" }),
    otherMember: await createMember(db, organization, { role: "member" }),
    approver: await createMember(db, organization, {
      role: "member",
      isApprover: true,
    }),
  }
  const caller = (who: keyof typeof members) =>
    organizationCaller(db, { organization, user: members[who].user })
  const quote = await createQuote(db, organization, {
    owner: members.owner.user,
    stage,
    total: "1000.0000",
  })
  return { organization, members, caller, quote }
}

const stageOf = async (db: Db, id: string) =>
  (await db.select().from(quotes).where(eq(quotes.id, id)))[0]!.stage

const stepsOf = (db: Db, quoteId: string) =>
  db
    .select()
    .from(approvalSteps)
    .where(eq(approvalSteps.quoteId, quoteId))
    .orderBy(asc(approvalSteps.createdAt), asc(approvalSteps.id))

describe("quote.markLost", () => {
  it.each([
    ["draft", "Draft"],
    ["approved", "Approved"],
    ["with_customer", "Sent"],
  ] as const)(
    "marks a Quote in %s as lost, on the Lost Stage's first Status",
    (stage, fromStatusName) =>
      withTestDb(async (db) => {
        const { caller, quote, members } = await setup(db, stage)
        const result = await caller("owner").quote.markLost({
          id: quote.id,
          reason: " Budget cut ",
        })
        expect(result).toMatchObject({
          stage: "lost",
          status: { name: "Lost" },
          rejected: false,
          updatedById: members.owner.user.id,
          step: {
            action: "mark_lost",
            fromStage: stage,
            toStage: "lost",
            fromStatusName,
            toStatusName: "Lost",
            comment: "Budget cut",
          },
        })
        expect(await stageOf(db, quote.id)).toBe("lost")
        const byId = await caller("owner").quote.byId({ id: quote.id })
        expect(byId).toMatchObject({ stage: "lost", locked: true })
        expect(byId.permissions).toMatchObject({
          canEdit: false,
          canMarkLost: false,
          canReopen: false,
        })
      })
  )

  it("marks a Rejected Draft as lost", () =>
    withTestDb(async (db) => {
      const { caller, quote, members } = await setup(db)
      await createApprovalStep(db, quote, {
        action: "reject",
        actor: members.approver.user,
      })
      await expect(
        caller("owner").quote.markLost({ id: quote.id, reason: "Gone quiet" })
      ).resolves.toMatchObject({ stage: "lost", rejected: false })
    }))

  it("tells the Owner to recall a Quote In Approval first", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db, "in_approval")
      await expect(
        caller("owner").quote.markLost({ id: quote.id, reason: "Dead" })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("Recall it first"),
      })
      expect(await stageOf(db, quote.id)).toBe("in_approval")
    }))

  it.each(["won", "lost"] as const)("is refused from %s", (stage) =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db, stage)
      await expect(
        caller("admin").quote.markLost({ id: quote.id, reason: "Dead" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      expect(await stageOf(db, quote.id)).toBe(stage)
      expect(await stepsOf(db, quote.id)).toEqual([])
    })
  )

  it("requires a reason", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      for (const reason of ["", "   "]) {
        await expect(
          caller("owner").quote.markLost({ id: quote.id, reason })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
      expect(await stageOf(db, quote.id)).toBe("draft")
    }))

  it("allows the Owner and an Admin; refuses a Manager, another Member and an Approver", () =>
    withTestDb(async (db) => {
      for (const who of ["manager", "otherMember", "approver"] as const) {
        const { caller, quote } = await setup(db, "approved")
        await expect(
          caller(who).quote.markLost({ id: quote.id, reason: "Dead" })
        ).rejects.toMatchObject({ code: "FORBIDDEN" })
        expect(await stageOf(db, quote.id)).toBe("approved")
      }
      const { caller, quote } = await setup(db, "approved")
      await expect(
        caller("admin").quote.markLost({ id: quote.id, reason: "Dead" })
      ).resolves.toMatchObject({ stage: "lost" })
    }))

  it("offers Mark as Lost in the permissions from Draft, Approved and With Customer only", () =>
    withTestDb(async (db) => {
      for (const [stage, expected] of [
        ["draft", true],
        ["in_approval", false],
        ["approved", true],
        ["with_customer", true],
        ["won", false],
        ["lost", false],
      ] as const) {
        const { caller, quote } = await setup(db, stage)
        const byId = await caller("owner").quote.byId({ id: quote.id })
        expect([stage, byId.permissions.canMarkLost]).toEqual([stage, expected])
      }
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) =>
          caller.quote.markLost({ id: quote.id, reason: "Hacked" }),
        snapshot: async () => ({
          stage: await stageOf(db, quote.id),
          steps: await stepsOf(db, quote.id),
        }),
      })
    }))
})

describe("quote.reopen", () => {
  it("lets an Admin reopen a Lost Quote to Draft, not Rejected", () =>
    withTestDb(async (db) => {
      const { caller, quote, members } = await setup(db, "approved")
      await caller("owner").quote.markLost({ id: quote.id, reason: "Paused" })
      const byIdLost = await caller("admin").quote.byId({ id: quote.id })
      expect(byIdLost.permissions.canReopen).toBe(true)
      const result = await caller("admin").quote.reopen({
        id: quote.id,
        comment: " Back on ",
      })
      expect(result).toMatchObject({
        stage: "draft",
        status: { name: "Draft" },
        rejected: false,
        updatedById: members.admin.user.id,
        step: {
          action: "reopen",
          fromStage: "lost",
          toStage: "draft",
          fromStatusName: "Lost",
          toStatusName: "Draft",
          comment: "Back on",
        },
      })
      const byId = await caller("owner").quote.byId({ id: quote.id })
      expect(byId).toMatchObject({
        stage: "draft",
        rejected: false,
        locked: false,
      })
      expect(byId.permissions).toMatchObject({ canEdit: true, canSubmit: true })
      expect((await stepsOf(db, quote.id)).map((s) => s.action)).toEqual([
        "mark_lost",
        "reopen",
      ])
      await expect(
        caller("owner").quote.submit({ id: quote.id })
      ).resolves.toMatchObject({ stage: "in_approval" })
    }))

  it("is Admin only", () =>
    withTestDb(async (db) => {
      for (const who of [
        "owner",
        "manager",
        "otherMember",
        "approver",
      ] as const) {
        const { caller, quote } = await setup(db, "lost")
        const byId = await caller(who).quote.byId({ id: quote.id })
        expect(byId.permissions.canReopen).toBe(false)
        await expect(
          caller(who).quote.reopen({ id: quote.id })
        ).rejects.toMatchObject({ code: "FORBIDDEN" })
        expect(await stageOf(db, quote.id)).toBe("lost")
      }
    }))

  it.each(["draft", "in_approval", "approved", "with_customer"] as const)(
    "is refused from %s",
    (stage) =>
      withTestDb(async (db) => {
        const { caller, quote } = await setup(db, stage)
        await expect(
          caller("admin").quote.reopen({ id: quote.id })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
        expect(await stageOf(db, quote.id)).toBe(stage)
      })
  )

  it("never reopens a Won Quote, and nothing else moves it either", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db, "won")
      await expect(
        caller("admin").quote.reopen({ id: quote.id })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("Won"),
      })
      await expect(
        caller("admin").quote.markLost({ id: quote.id, reason: "Changed mind" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      await expect(
        caller("admin").quote.recordCustomerOutcome({
          id: quote.id,
          outcome: "lost",
          note: "Changed mind",
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      expect(await stageOf(db, quote.id)).toBe("won")
      expect(await stepsOf(db, quote.id)).toEqual([])
      const byId = await caller("admin").quote.byId({ id: quote.id })
      expect(byId.permissions).toMatchObject({
        canReopen: false,
        canMarkLost: false,
      })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db, "lost")
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.quote.reopen({ id: quote.id }),
        snapshot: async () => ({
          stage: await stageOf(db, quote.id),
          steps: await stepsOf(db, quote.id),
        }),
      })
    }))
})

describe("Lost Quotes outside the pipeline", () => {
  it("leaves the open pipeline and every Key Insight", () =>
    withTestDb(async (db) => {
      const { caller, quote, members } = await setup(db)
      // A low-margin Draft, Rejected, Valid Until tomorrow, created today:
      // it counts on every card it can before it's lost.
      const tomorrow = new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 10)
      await db
        .update(quotes)
        .set({ marginPct: "5.0000", validUntil: tomorrow })
        .where(eq(quotes.id, quote.id))
      await createApprovalStep(db, quote, {
        action: "reject",
        actor: members.approver.user,
      })
      const counts = async () => {
        const insights = await caller("owner").quote.insights()
        const overview = await caller("owner").dashboard.overview()
        return {
          open: overview.open.count,
          cards: Object.fromEntries(
            insights.cards.map((card) => [card.key, card.count])
          ),
        }
      }
      expect(await counts()).toEqual({
        open: 1,
        cards: {
          pending_approval: 0,
          high_value_pipeline: 1,
          low_margin: 1,
          valid_until_soon: 1,
          this_month: 1,
          rejected: 1,
        },
      })
      await caller("owner").quote.markLost({ id: quote.id, reason: "Dead" })
      expect(await counts()).toEqual({
        open: 0,
        cards: {
          pending_approval: 0,
          high_value_pipeline: 0,
          low_margin: 0,
          valid_until_soon: 0,
          this_month: 0,
          rejected: 0,
        },
      })
    }))
})
