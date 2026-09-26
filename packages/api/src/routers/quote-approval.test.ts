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
 * An Organization with a Member who owns a Draft Quote with a positive
 * Total, plus an Admin, a Manager, another Member, an Approver (a Member)
 * and an Approver who is also an Admin. `rejected` makes the Draft a
 * Rejected one (its latest Approval Step is that rejection).
 */
async function setup(
  db: Db,
  quote: {
    stage?: QuoteStage
    rejected?: "reject" | "customer_rejected"
    total?: string
  } = {}
) {
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
    adminApprover: await createMember(db, organization, {
      role: "admin",
      isApprover: true,
    }),
  }
  const caller = (who: keyof typeof members) =>
    organizationCaller(db, { organization, user: members[who].user })
  const row = await createQuote(db, organization, {
    owner: members.owner.user,
    stage: quote.stage ?? "draft",
    total: quote.total ?? "1000.0000",
  })
  if (quote.rejected) {
    await createApprovalStep(db, row, {
      action: quote.rejected,
      actor: members.approver.user,
    })
  }
  return { organization, members, caller, quote: row }
}

const stageOf = async (db: Db, id: string) =>
  (await db.select().from(quotes).where(eq(quotes.id, id)))[0]!.stage

const stepsOf = (db: Db, quoteId: string) =>
  db
    .select()
    .from(approvalSteps)
    .where(eq(approvalSteps.quoteId, quoteId))
    .orderBy(asc(approvalSteps.createdAt), asc(approvalSteps.id))

describe("quote.submit", () => {
  it.each([undefined, "reject", "customer_rejected"] as const)(
    "moves a Draft Quote (rejected by: %s) to In Approval and records the step",
    (rejected) =>
      withTestDb(async (db) => {
        const { caller, quote, members } = await setup(db, { rejected })
        const result = await caller("owner").quote.submit({
          id: quote.id,
          comment: "  Please review  ",
        })
        expect(result).toMatchObject({
          id: quote.id,
          stage: "in_approval",
          status: { name: "Pending Approval" },
          rejected: false,
          updatedById: members.owner.user.id,
          step: {
            action: "submit",
            fromStage: "draft",
            toStage: "in_approval",
            fromStatusName: "Draft",
            toStatusName: "Pending Approval",
            comment: "Please review",
          },
        })
        expect(await stageOf(db, quote.id)).toBe("in_approval")
        const steps = await stepsOf(db, quote.id)
        expect(steps).toHaveLength(rejected ? 2 : 1)
        expect(steps.at(-1)).toMatchObject({
          action: "submit",
          actorId: members.owner.user.id,
          comment: "Please review",
        })
      })
  )

  it("stores a blank comment as none", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      await caller("owner").quote.submit({ id: quote.id, comment: "  " })
      expect((await stepsOf(db, quote.id))[0]!.comment).toBeNull()
    }))

  it.each([
    ["0", "A Quote with a zero Total can't be submitted."],
    ["-5", "A Quote with a negative Total can't be submitted."],
  ])("refuses a Total of %s with its own message", (total, message) =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db, { total })
      await expect(
        caller("owner").quote.submit({ id: quote.id })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message })
      expect(await stageOf(db, quote.id)).toBe("draft")
      expect(await stepsOf(db, quote.id)).toHaveLength(0)
    })
  )

  it.each(["in_approval", "approved", "with_customer", "won", "lost"] as const)(
    "refuses a Quote in %s (wrong Stage)",
    (stage) =>
      withTestDb(async (db) => {
        const { caller, quote } = await setup(db, { stage })
        await expect(
          caller("owner").quote.submit({ id: quote.id })
        ).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: "Only a Draft Quote can be submitted.",
        })
        expect(await stageOf(db, quote.id)).toBe(stage)
      })
  )

  it.each(["admin", "manager", "otherMember", "approver"] as const)(
    "is the Owner's alone (%s is refused)",
    (who) =>
      withTestDb(async (db) => {
        const { caller, quote } = await setup(db)
        await expect(
          caller(who).quote.submit({ id: quote.id })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: "Only the Quote Owner can submit this Quote.",
        })
        expect(await stageOf(db, quote.id)).toBe("draft")
      })
  )

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (c) => c.quote.submit({ id: quote.id }),
        snapshot: () => stepsOf(db, quote.id),
      })
    }))
})

describe("quote.approve and quote.reject", () => {
  it.each([
    ["approve", "approved", "Approved", false],
    ["reject", "draft", "Draft", true],
  ] as const)("%s moves In Approval to %s", (action, to, name, rejected) =>
    withTestDb(async (db) => {
      const { caller, quote, members } = await setup(db, {
        stage: "in_approval",
      })
      const result = await caller("approver").quote[action]({
        id: quote.id,
        comment: "Looks fine",
      })
      expect(result).toMatchObject({
        stage: to,
        status: { name },
        rejected,
        step: {
          action,
          fromStage: "in_approval",
          toStage: to,
          fromStatusName: "Pending Approval",
          toStatusName: name,
        },
      })
      expect(await stageOf(db, quote.id)).toBe(to)
      expect(await caller("owner").quote.byId({ id: quote.id })).toMatchObject({
        stage: to,
        rejected,
        locked: to !== "draft",
      })
      expect(await stepsOf(db, quote.id)).toMatchObject([
        { action, actorId: members.approver.user.id, comment: "Looks fine" },
      ])
    })
  )

  it.each(["approve", "reject"] as const)(
    "%s is for Approvers only, whatever their Role",
    (action) =>
      withTestDb(async (db) => {
        const { caller, quote } = await setup(db, {
          stage: "in_approval",
        })
        for (const who of ["admin", "manager", "otherMember"] as const) {
          await expect(
            caller(who).quote[action]({ id: quote.id })
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: "Only an Approver can approve or reject.",
          })
        }
        expect(await stageOf(db, quote.id)).toBe("in_approval")
        // An Admin who is also an Approver may.
        await caller("adminApprover").quote[action]({ id: quote.id })
      })
  )

  it.each(["approve", "reject"] as const)(
    "%s refuses an Approver's own Quote (self-approval)",
    (action) =>
      withTestDb(async (db) => {
        const { organization, members } = await setup(db)
        const own = await createQuote(db, organization, {
          owner: members.approver.user,
          stage: "in_approval",
          total: "500",
        })
        await expect(
          organizationCaller(db, {
            organization,
            user: members.approver.user,
          }).quote[action]({ id: own.id })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: "You can't approve or reject your own Quote.",
        })
        expect(await stageOf(db, own.id)).toBe("in_approval")
        expect(await stepsOf(db, own.id)).toHaveLength(0)
      })
  )

  it.each(["draft", "approved", "with_customer", "won", "lost"] as const)(
    "refuses outside In Approval (%s)",
    (stage) =>
      withTestDb(async (db) => {
        const { caller, quote } = await setup(db, { stage })
        for (const action of ["approve", "reject"] as const) {
          await expect(
            caller("approver").quote[action]({ id: quote.id })
          ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
        }
        expect(await stageOf(db, quote.id)).toBe(stage)
      })
  )

  it.each(["approve", "reject"] as const)(
    "%s is isolated from other Organizations",
    (action) =>
      withTestDb(async (db) => {
        const { organization, quote } = await setup(db, {
          stage: "in_approval",
        })
        await expectIsolated(db, {
          owner: organization,
          call: (c) => c.quote[action]({ id: quote.id }),
          snapshot: () => stepsOf(db, quote.id),
        })
      })
  )
})

describe("quote.recall", () => {
  it.each(["owner", "admin"] as const)(
    "the %s returns a Quote In Approval to Draft",
    (who) =>
      withTestDb(async (db) => {
        const { caller, quote, members } = await setup(db, {
          stage: "in_approval",
        })
        await expect(
          caller(who).quote.recall({ id: quote.id, comment: "Oops" })
        ).resolves.toMatchObject({ stage: "draft", rejected: false })
        expect(await stageOf(db, quote.id)).toBe("draft")
        expect(await stepsOf(db, quote.id)).toMatchObject([
          {
            action: "recall",
            fromStage: "in_approval",
            toStage: "draft",
            actorId: members[who].user.id,
          },
        ])
      })
  )

  it.each(["manager", "otherMember", "approver"] as const)(
    "refuses %s",
    (who) =>
      withTestDb(async (db) => {
        const { caller, quote } = await setup(db, {
          stage: "in_approval",
        })
        await expect(
          caller(who).quote.recall({ id: quote.id })
        ).rejects.toMatchObject({ code: "FORBIDDEN" })
        expect(await stageOf(db, quote.id)).toBe("in_approval")
      })
  )

  it.each(["draft", "approved", "with_customer", "won"] as const)(
    "refuses outside In Approval (%s)",
    (stage) =>
      withTestDb(async (db) => {
        const { caller, quote } = await setup(db, { stage })
        await expect(
          caller("owner").quote.recall({ id: quote.id })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      })
  )

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db, {
        stage: "in_approval",
      })
      await expectIsolated(db, {
        owner: organization,
        call: (c) => c.quote.recall({ id: quote.id }),
        snapshot: () => stepsOf(db, quote.id),
      })
    }))
})

describe("the lifecycle", () => {
  it("records every step in order and unlocks editing after a rejection", () =>
    withTestDb(async (db) => {
      const { caller, quote, members } = await setup(db)
      await caller("owner").quote.submit({ id: quote.id, comment: "v1" })
      // Locked while In Approval.
      await expect(
        caller("owner").quote.rename({ id: quote.id, name: "Changed" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      await caller("owner").quote.recall({ id: quote.id })
      await caller("owner").quote.submit({ id: quote.id, comment: "v2" })
      await caller("approver").quote.reject({
        id: quote.id,
        comment: "Too cheap",
      })
      // A rejection returns it to Draft (Rejected), which unlocks it.
      expect(await caller("owner").quote.byId({ id: quote.id })).toMatchObject({
        stage: "draft",
        rejected: true,
        locked: false,
      })
      await caller("owner").quote.rename({ id: quote.id, name: "Changed" })
      await caller("owner").quote.submit({ id: quote.id })
      await caller("adminApprover").quote.approve({ id: quote.id })

      const { steps } = await caller("otherMember").quote.approvalHistory({
        id: quote.id,
      })
      expect(
        steps.map((s) => [s.action, s.fromStage, s.toStage, s.comment])
      ).toEqual([
        ["submit", "draft", "in_approval", "v1"],
        ["recall", "in_approval", "draft", null],
        ["submit", "draft", "in_approval", "v2"],
        ["reject", "in_approval", "draft", "Too cheap"],
        ["submit", "draft", "in_approval", null],
        ["approve", "in_approval", "approved", null],
      ])
      expect(steps.map((s) => s.toStatusName)).toEqual([
        "Pending Approval",
        "Draft",
        "Pending Approval",
        "Draft",
        "Pending Approval",
        "Approved",
      ])
      expect(steps[3]!.actor).toMatchObject({
        id: members.approver.user.id,
        email: members.approver.user.email,
      })
      const byId = await caller("owner").quote.byId({ id: quote.id })
      expect(byId).toMatchObject({ stage: "approved", locked: true })
      expect(byId.permissions).toMatchObject({
        canEdit: false,
        canSubmit: false,
        canRecall: false,
      })
    }))

  it("quote.byId permissions show each viewer's actions", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db, { stage: "in_approval" })
      const perms = async (who: Parameters<typeof caller>[0]) =>
        (await caller(who).quote.byId({ id: quote.id })).permissions
      expect(await perms("owner")).toMatchObject({
        canSubmit: false,
        canApprove: false,
        canRecall: true,
      })
      expect(await perms("approver")).toMatchObject({
        canApprove: true,
        canReject: true,
        canRecall: false,
      })
      expect(await perms("admin")).toMatchObject({
        canApprove: false,
        canRecall: true,
      })
    }))
})

describe("quote.approvalHistory", () => {
  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (c) => c.quote.approvalHistory({ id: quote.id }),
      })
    }))
})

describe("quote.awaitingMyApproval", () => {
  it("lists other people's Pending Approval Quotes, longest-waiting first", () =>
    withTestDb(async (db) => {
      const { organization, members, caller, quote } = await setup(db)
      const later = await createQuote(db, organization, {
        owner: members.otherMember.user,
        total: "200",
        name: "Later",
      })
      const own = await createQuote(db, organization, {
        owner: members.approver.user,
        total: "300",
      })
      await createQuote(db, organization, {
        owner: members.otherMember.user,
        stage: "draft",
        total: "400",
      })
      await caller("owner").quote.submit({ id: quote.id, comment: "First" })
      await organizationCaller(db, {
        organization,
        user: members.otherMember.user,
      }).quote.submit({ id: later.id })
      await organizationCaller(db, {
        organization,
        user: members.approver.user,
      }).quote.submit({ id: own.id })

      const result = await caller("approver").quote.awaitingMyApproval({})
      expect(result.total).toBe(2)
      expect(result.rows.map((r) => r.id)).toEqual([quote.id, later.id])
      expect(result.rows[0]).toMatchObject({
        owner: { id: members.owner.user.id },
        submitComment: "First",
        total: "1000.0000",
      })
      expect(result.rows[0]!.submittedAt).toBeInstanceOf(Date)

      // The other Approver sees all three.
      const other = await caller("adminApprover").quote.awaitingMyApproval({})
      expect(other.total).toBe(3)
    }))

  it("is for Approvers only", () =>
    withTestDb(async (db) => {
      const { caller } = await setup(db)
      await expect(
        caller("admin").quote.awaitingMyApproval({})
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    }))

  it("never lists another Organization's Quotes", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db, {
        stage: "in_approval",
      })
      expect(
        (await caller("approver").quote.awaitingMyApproval({})).total
      ).toBe(1)
      const other = await createOrganization(db)
      const { user } = await createMember(db, other, { isApprover: true })
      const result = await organizationCaller(db, {
        organization: other,
        user,
      }).quote.awaitingMyApproval({})
      expect(result.total).toBe(0)
      // A non-member is refused on the owner's subdomain.
      await expect(
        organizationCaller(db, { organization, user }).quote.awaitingMyApproval(
          {}
        )
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})
