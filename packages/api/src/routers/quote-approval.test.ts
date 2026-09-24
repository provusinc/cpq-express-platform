import { describe, expect, it } from "vitest"

import { asc, eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import type { QuoteStatus } from "@workspace/domain/enums"

import {
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
 * and an Approver who is also an Admin.
 */
async function setup(
  db: Db,
  quote: { status?: QuoteStatus; total?: string } = {}
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
    status: quote.status ?? "draft",
    total: quote.total ?? "1000.0000",
  })
  return { organization, members, caller, quote: row }
}

const statusOf = async (db: Db, id: string) =>
  (await db.select().from(quotes).where(eq(quotes.id, id)))[0]!.status

const stepsOf = (db: Db, quoteId: string) =>
  db
    .select()
    .from(approvalSteps)
    .where(eq(approvalSteps.quoteId, quoteId))
    .orderBy(asc(approvalSteps.createdAt), asc(approvalSteps.id))

describe("quote.submit", () => {
  it.each(["draft", "rejected", "customer_rejected"] as const)(
    "moves a %s Quote to Pending Approval and records the step",
    (status) =>
      withTestDb(async (db) => {
        const { caller, quote, members } = await setup(db, { status })
        const result = await caller("owner").quote.submit({
          id: quote.id,
          comment: "  Please review  ",
        })
        expect(result).toMatchObject({
          id: quote.id,
          status: "pending_approval",
          updatedById: members.owner.user.id,
          step: {
            action: "submit",
            fromStatus: status,
            toStatus: "pending_approval",
            comment: "Please review",
          },
        })
        expect(await statusOf(db, quote.id)).toBe("pending_approval")
        const steps = await stepsOf(db, quote.id)
        expect(steps).toHaveLength(1)
        expect(steps[0]).toMatchObject({
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
      expect(await statusOf(db, quote.id)).toBe("draft")
      expect(await stepsOf(db, quote.id)).toHaveLength(0)
    })
  )

  it.each([
    "pending_approval",
    "approved",
    "pending_customer_approval",
    "customer_approved",
  ] as const)("refuses a %s Quote (wrong status)", (status) =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db, { status })
      await expect(
        caller("owner").quote.submit({ id: quote.id })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message:
          "Only a Draft, Rejected or Customer Rejected Quote can be submitted.",
      })
      expect(await statusOf(db, quote.id)).toBe(status)
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
        expect(await statusOf(db, quote.id)).toBe("draft")
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
    ["approve", "approved"],
    ["reject", "rejected"],
  ] as const)("%s moves Pending Approval to %s", (action, to) =>
    withTestDb(async (db) => {
      const { caller, quote, members } = await setup(db, {
        status: "pending_approval",
      })
      const result = await caller("approver").quote[action]({
        id: quote.id,
        comment: "Looks fine",
      })
      expect(result).toMatchObject({
        status: to,
        step: { action, fromStatus: "pending_approval", toStatus: to },
      })
      expect(await statusOf(db, quote.id)).toBe(to)
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
          status: "pending_approval",
        })
        for (const who of ["admin", "manager", "otherMember"] as const) {
          await expect(
            caller(who).quote[action]({ id: quote.id })
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: "Only an Approver can approve or reject.",
          })
        }
        expect(await statusOf(db, quote.id)).toBe("pending_approval")
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
          status: "pending_approval",
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
        expect(await statusOf(db, own.id)).toBe("pending_approval")
        expect(await stepsOf(db, own.id)).toHaveLength(0)
      })
  )

  it.each(["draft", "approved", "rejected", "customer_rejected"] as const)(
    "refuses outside Pending Approval (%s)",
    (status) =>
      withTestDb(async (db) => {
        const { caller, quote } = await setup(db, { status })
        for (const action of ["approve", "reject"] as const) {
          await expect(
            caller("approver").quote[action]({ id: quote.id })
          ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
        }
        expect(await statusOf(db, quote.id)).toBe(status)
      })
  )

  it.each(["approve", "reject"] as const)(
    "%s is isolated from other Organizations",
    (action) =>
      withTestDb(async (db) => {
        const { organization, quote } = await setup(db, {
          status: "pending_approval",
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
    "the %s returns a Pending Approval Quote to Draft",
    (who) =>
      withTestDb(async (db) => {
        const { caller, quote, members } = await setup(db, {
          status: "pending_approval",
        })
        await caller(who).quote.recall({ id: quote.id, comment: "Oops" })
        expect(await statusOf(db, quote.id)).toBe("draft")
        expect(await stepsOf(db, quote.id)).toMatchObject([
          {
            action: "recall",
            fromStatus: "pending_approval",
            toStatus: "draft",
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
          status: "pending_approval",
        })
        await expect(
          caller(who).quote.recall({ id: quote.id })
        ).rejects.toMatchObject({ code: "FORBIDDEN" })
        expect(await statusOf(db, quote.id)).toBe("pending_approval")
      })
  )

  it.each(["draft", "approved", "rejected"] as const)(
    "refuses outside Pending Approval (%s)",
    (status) =>
      withTestDb(async (db) => {
        const { caller, quote } = await setup(db, { status })
        await expect(
          caller("owner").quote.recall({ id: quote.id })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      })
  )

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db, {
        status: "pending_approval",
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
      // Locked while Pending Approval.
      await expect(
        caller("owner").quote.rename({ id: quote.id, name: "Changed" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      await caller("owner").quote.recall({ id: quote.id })
      await caller("owner").quote.submit({ id: quote.id, comment: "v2" })
      await caller("approver").quote.reject({
        id: quote.id,
        comment: "Too cheap",
      })
      // Rejected unlocks it.
      await caller("owner").quote.rename({ id: quote.id, name: "Changed" })
      await caller("owner").quote.submit({ id: quote.id })
      await caller("adminApprover").quote.approve({ id: quote.id })

      const { steps } = await caller("otherMember").quote.approvalHistory({
        id: quote.id,
      })
      expect(
        steps.map((s) => [s.action, s.fromStatus, s.toStatus, s.comment])
      ).toEqual([
        ["submit", "draft", "pending_approval", "v1"],
        ["recall", "pending_approval", "draft", null],
        ["submit", "draft", "pending_approval", "v2"],
        ["reject", "pending_approval", "rejected", "Too cheap"],
        ["submit", "rejected", "pending_approval", null],
        ["approve", "pending_approval", "approved", null],
      ])
      expect(steps[3]!.actor).toMatchObject({
        id: members.approver.user.id,
        email: members.approver.user.email,
      })
      const byId = await caller("owner").quote.byId({ id: quote.id })
      expect(byId).toMatchObject({ status: "approved", locked: true })
      expect(byId.permissions).toMatchObject({
        canEdit: false,
        canSubmit: false,
        canRecall: false,
      })
    }))

  it("quote.byId permissions show each viewer's actions", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db, { status: "pending_approval" })
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
        status: "draft",
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
        status: "pending_approval",
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
