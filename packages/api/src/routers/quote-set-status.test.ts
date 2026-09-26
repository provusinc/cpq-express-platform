/**
 * Moving between the Quote Statuses of a Stage (#34): `quote.setStatus`
 * (per-Stage permissions, cross-Stage refusal, the status_change step, the
 * Stage, lock and Rejected untouched), the optional target Status of every
 * transition, and isolation.
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
  createQuoteStatus,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const { approvalSteps, quotes } = schema

/** A second Status per Stage, named after the default one. */
const SECOND: Record<QuoteStage, string> = {
  draft: "Internal review",
  in_approval: "Legal review",
  approved: "Ready to send",
  with_customer: "Verbal yes",
  won: "Invoiced",
  lost: "Archived loss",
}

/**
 * An Organization with a second Status in every Stage, whose Member owns a
 * Quote in `stage` (positive Total), plus an Admin, a Manager, another
 * Member, an Approver and an Admin who isn't an Approver.
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
  const second = Object.fromEntries(
    await Promise.all(
      (Object.keys(SECOND) as QuoteStage[]).map(async (s) => [
        s,
        await createQuoteStatus(db, organization, {
          stage: s,
          name: SECOND[s],
        }),
      ])
    )
  ) as Record<QuoteStage, { id: string; name: string }>
  const caller = (who: keyof typeof members) =>
    organizationCaller(db, { organization, user: members[who].user })
  const quote = await createQuote(db, organization, {
    owner: members.owner.user,
    stage,
    total: "1000.0000",
  })
  return { organization, members, second, caller, quote }
}

const rowOf = async (db: Db, id: string) =>
  (await db.select().from(quotes).where(eq(quotes.id, id)))[0]!

const stepsOf = (db: Db, quoteId: string) =>
  db
    .select()
    .from(approvalSteps)
    .where(eq(approvalSteps.quoteId, quoteId))
    .orderBy(asc(approvalSteps.createdAt), asc(approvalSteps.id))

type Who = "owner" | "admin" | "manager" | "otherMember" | "approver"

describe("quote.setStatus", () => {
  it.each<[QuoteStage, Who[], Who[]]>([
    ["draft", ["owner", "admin"], ["otherMember", "approver"]],
    ["in_approval", ["approver"], ["owner", "admin", "manager"]],
    ["approved", ["owner", "admin"], ["manager", "approver"]],
    ["with_customer", ["owner", "admin"], ["otherMember", "approver"]],
    ["won", ["admin"], ["owner", "manager", "approver"]],
    ["lost", ["admin"], ["owner", "manager", "approver"]],
  ])("in %s: allowed for %o, refused for %o", (stage, allowed, refused) =>
    withTestDb(async (db) => {
      const { caller, quote, second } = await setup(db, stage)
      for (const who of refused) {
        await expect(
          caller(who).quote.setStatus({
            id: quote.id,
            statusId: second[stage].id,
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" })
      }
      expect(await stepsOf(db, quote.id)).toEqual([])
      for (const who of allowed) {
        const before = await rowOf(db, quote.id)
        const target =
          before.statusId === second[stage].id
            ? (await caller(who).quote.byId({ id: quote.id })).stageStatuses[0]!
            : second[stage]
        await expect(
          caller(who).quote.setStatus({ id: quote.id, statusId: target.id })
        ).resolves.toMatchObject({ stage, status: { id: target.id } })
      }
    })
  )

  it("moves within the Stage and records a status_change step", () =>
    withTestDb(async (db) => {
      const { caller, quote, second, members } = await setup(db, "in_approval")
      const result = await caller("approver").quote.setStatus({
        id: quote.id,
        statusId: second.in_approval.id,
        comment: " Over to Legal ",
      })
      expect(result).toMatchObject({
        stage: "in_approval",
        status: { id: second.in_approval.id, name: "Legal review" },
        rejected: false,
        updatedById: members.approver.user.id,
        step: {
          action: "status_change",
          fromStage: "in_approval",
          toStage: "in_approval",
          fromStatusName: "Pending Approval",
          toStatusName: "Legal review",
          comment: "Over to Legal",
        },
      })
      const row = await rowOf(db, quote.id)
      expect(row).toMatchObject({
        stage: "in_approval",
        statusId: second.in_approval.id,
      })
      const history = await caller("owner").quote.approvalHistory({
        id: quote.id,
      })
      expect(history.steps).toMatchObject([
        {
          action: "status_change",
          fromStatusName: "Pending Approval",
          toStatusName: "Legal review",
          actor: { id: members.approver.user.id },
        },
      ])
      // Still one decision: still In Approval, locked, and approvable.
      const byId = await caller("approver").quote.byId({ id: quote.id })
      expect(byId).toMatchObject({
        stage: "in_approval",
        locked: true,
        status: { name: "Legal review" },
      })
      expect(byId.permissions).toMatchObject({
        canApprove: true,
        canSetStatus: true,
      })
      expect(byId.stageStatuses.map((s) => s.name)).toEqual([
        "Pending Approval",
        "Legal review",
      ])
    }))

  it("doesn't enforce an order", () =>
    withTestDb(async (db) => {
      const { caller, quote, second } = await setup(db, "approved")
      const first = (await caller("owner").quote.byId({ id: quote.id }))
        .stageStatuses[0]!
      await caller("owner").quote.setStatus({
        id: quote.id,
        statusId: second.approved.id,
      })
      await expect(
        caller("owner").quote.setStatus({ id: quote.id, statusId: first.id })
      ).resolves.toMatchObject({ status: { id: first.id } })
      expect((await stepsOf(db, quote.id)).map((s) => s.toStatusName)).toEqual([
        "Ready to send",
        "Approved",
      ])
    }))

  it("refuses another Stage's Status and the current one", () =>
    withTestDb(async (db) => {
      const { caller, quote, second } = await setup(db, "in_approval")
      await expect(
        caller("approver").quote.setStatus({
          id: quote.id,
          statusId: second.approved.id,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      await expect(
        caller("approver").quote.setStatus({
          id: quote.id,
          statusId: quote.statusId,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      expect(await rowOf(db, quote.id)).toMatchObject({
        stage: "in_approval",
        statusId: quote.statusId,
      })
      expect(await stepsOf(db, quote.id)).toEqual([])
    }))

  it("refuses a Draft the caller can't edit", () =>
    withTestDb(async (db) => {
      const { caller, quote, second, organization } = await setup(db)
      const owner = await createMember(db, organization, { role: "admin" })
      const adminsQuote = await createQuote(db, organization, {
        owner: owner.user,
      })
      await expect(
        caller("manager").quote.setStatus({
          id: adminsQuote.id,
          statusId: second.draft.id,
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
      await expect(
        caller("manager").quote.setStatus({
          id: quote.id,
          statusId: second.draft.id,
        })
      ).resolves.toMatchObject({ stage: "draft" })
    }))

  it("keeps a Rejected Draft Rejected, and never makes one Rejected", () =>
    withTestDb(async (db) => {
      const { caller, quote, second, members, organization } = await setup(db)
      await createApprovalStep(db, quote, {
        action: "reject",
        actor: members.approver.user,
        createdAt: new Date(Date.now() - 60_000),
      })
      await expect(
        caller("owner").quote.setStatus({
          id: quote.id,
          statusId: second.draft.id,
        })
      ).resolves.toMatchObject({ rejected: true })
      expect(
        (await caller("owner").quote.byId({ id: quote.id })).rejected
      ).toBe(true)
      const list = await caller("owner").quote.list({ rejected: true })
      expect(list.rows.map((r) => r.id)).toEqual([quote.id])

      const other = await createQuote(db, organization, {
        owner: members.owner.user,
      })
      await expect(
        caller("owner").quote.setStatus({
          id: other.id,
          statusId: second.draft.id,
        })
      ).resolves.toMatchObject({ rejected: false })
    }))

  it("ends a rejection only at the next Submission", () =>
    withTestDb(async (db) => {
      const { caller, quote, second, members } = await setup(db)
      await createApprovalStep(db, quote, {
        action: "reject",
        actor: members.approver.user,
        createdAt: new Date(Date.now() - 60_000),
      })
      await caller("owner").quote.setStatus({
        id: quote.id,
        statusId: second.draft.id,
      })
      await expect(
        caller("owner").quote.submit({ id: quote.id })
      ).resolves.toMatchObject({ stage: "in_approval", rejected: false })
    }))

  it("doesn't count a Won Quote twice on the Dashboard", () =>
    withTestDb(async (db) => {
      const { caller, quote, second, members } = await setup(db, "won")
      await createApprovalStep(db, quote, {
        action: "customer_approved",
        actor: members.owner.user,
      })
      await caller("admin").quote.setStatus({
        id: quote.id,
        statusId: second.won.id,
      })
      const { buckets } = await caller("owner").dashboard.valueOverTime({
        range: "7d",
      })
      expect(buckets.reduce((n, b) => n + b.won.count, 0)).toBe(1)
    }))

  it("is refused for a Status of another Organization", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const other = await createOrganization(db)
      const foreign = await createQuoteStatus(db, other, {
        stage: "draft",
        name: "Foreign",
      })
      await expect(
        caller("owner").quote.setStatus({ id: quote.id, statusId: foreign.id })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      expect(await stepsOf(db, quote.id)).toEqual([])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote, second } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) =>
          caller.quote.setStatus({ id: quote.id, statusId: second.draft.id }),
        snapshot: async () => ({
          quote: await rowOf(db, quote.id),
          steps: await stepsOf(db, quote.id),
        }),
      })
    }))
})

describe("transitions with a target Status", () => {
  it("land on the picked Status of the target Stage", () =>
    withTestDb(async (db) => {
      const { caller, quote, second } = await setup(db)
      await expect(
        caller("owner").quote.submit({
          id: quote.id,
          statusId: second.in_approval.id,
        })
      ).resolves.toMatchObject({
        stage: "in_approval",
        status: { id: second.in_approval.id, name: "Legal review" },
        step: {
          action: "submit",
          fromStatusName: "Draft",
          toStatusName: "Legal review",
        },
      })
      await expect(
        caller("approver").quote.approve({
          id: quote.id,
          statusId: second.approved.id,
        })
      ).resolves.toMatchObject({
        stage: "approved",
        status: { name: "Ready to send" },
        step: { fromStatusName: "Legal review", toStatusName: "Ready to send" },
      })
      await expect(
        caller("owner").quote.markSent({
          id: quote.id,
          statusId: second.with_customer.id,
        })
      ).resolves.toMatchObject({
        stage: "with_customer",
        status: { name: "Verbal yes" },
      })
      await expect(
        caller("owner").quote.recordCustomerOutcome({
          id: quote.id,
          outcome: "approved",
          statusId: second.won.id,
        })
      ).resolves.toMatchObject({ stage: "won", status: { name: "Invoiced" } })
    }))

  it("default to the target Stage's first Status", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db, "in_approval")
      await expect(
        caller("approver").quote.reject({ id: quote.id })
      ).resolves.toMatchObject({ stage: "draft", status: { name: "Draft" } })
    }))

  it.each<[string, QuoteStage, (c: Ctx) => Promise<unknown>]>([
    [
      "reject",
      "in_approval",
      ({ caller, quote, second }) =>
        caller("approver").quote.reject({
          id: quote.id,
          statusId: second.draft.id,
        }),
    ],
    [
      "recall",
      "in_approval",
      ({ caller, quote, second }) =>
        caller("owner").quote.recall({
          id: quote.id,
          statusId: second.draft.id,
        }),
    ],
    [
      "markLost",
      "approved",
      ({ caller, quote, second }) =>
        caller("owner").quote.markLost({
          id: quote.id,
          reason: "Budget cut",
          statusId: second.lost.id,
        }),
    ],
    [
      "reopen",
      "lost",
      ({ caller, quote, second }) =>
        caller("admin").quote.reopen({
          id: quote.id,
          statusId: second.draft.id,
        }),
    ],
    [
      "recordCustomerOutcome (revise)",
      "with_customer",
      ({ caller, quote, second }) =>
        caller("owner").quote.recordCustomerOutcome({
          id: quote.id,
          outcome: "revise",
          statusId: second.draft.id,
        }),
    ],
    [
      "recordCustomerOutcome (lost)",
      "with_customer",
      ({ caller, quote, second }) =>
        caller("owner").quote.recordCustomerOutcome({
          id: quote.id,
          outcome: "lost",
          note: "Went elsewhere",
          statusId: second.lost.id,
        }),
    ],
  ])("%s takes the target Status", (_name, stage, run) =>
    withTestDb(async (db) => {
      const ctx = await setup(db, stage)
      const result = (await run(ctx)) as { status: { name: string } }
      expect(Object.values(SECOND)).toContain(result.status.name)
    })
  )

  it("refuse a Status of another Stage, changing nothing", () =>
    withTestDb(async (db) => {
      const { caller, quote, second } = await setup(db)
      await expect(
        caller("owner").quote.submit({
          id: quote.id,
          statusId: second.approved.id,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      expect(await rowOf(db, quote.id)).toMatchObject({
        stage: "draft",
        statusId: quote.statusId,
      })
      expect(await stepsOf(db, quote.id)).toEqual([])
    }))

  it("refuse another Organization's Status", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const other = await createOrganization(db)
      const foreign = await createQuoteStatus(db, other, {
        stage: "in_approval",
        name: "Foreign",
      })
      await expect(
        caller("owner").quote.submit({ id: quote.id, statusId: foreign.id })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      expect((await rowOf(db, quote.id)).stage).toBe("draft")
    }))
})

type Ctx = Awaited<ReturnType<typeof setup>>
