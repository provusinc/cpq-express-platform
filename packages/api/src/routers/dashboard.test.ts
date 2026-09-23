import { describe, expect, it } from "vitest"

import { schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import type { QuoteStatus } from "@workspace/domain/enums"

import {
  createAccount,
  createMember,
  createOrganization,
  createQuote,
  createUser,
  organizationCaller,
  withTestDb,
} from "../test"

const DAY_MS = 86_400_000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS)
const day = (offset: number) =>
  new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10)

/** An Organization with a Member (the caller's default) and an Approver. */
async function setup(db: Db) {
  const organization = await createOrganization(db)
  const { user } = await createMember(db, organization, { role: "member" })
  const { user: approver } = await createMember(db, organization, {
    isApprover: true,
  })
  const account = await createAccount(db, organization, { name: "Initech" })
  const caller = organizationCaller(db, { organization, user })
  const asApprover = organizationCaller(db, { organization, user: approver })
  const quote = (
    status: QuoteStatus,
    fields: Partial<typeof schema.quotes.$inferInsert> & {
      owner?: { id: string }
      account?: { id: string }
    } = {}
  ) =>
    createQuote(db, organization, {
      owner: fields.owner ?? user,
      account: fields.account ?? account,
      status,
      total: "1000",
      marginPct: "40",
      ...fields,
    })
  const submitted = (quoteId: string, days: number) =>
    db.insert(schema.approvalSteps).values({
      organizationId: organization.id,
      quoteId,
      action: "submit",
      fromStatus: "draft",
      toStatus: "pending_approval",
      actorId: user.id,
      createdAt: daysAgo(days),
    })
  return {
    organization,
    user,
    approver,
    account,
    caller,
    asApprover,
    quote,
    submitted,
  }
}

describe("dashboard.overview", () => {
  it("is all zeros for an Organization without Quotes", () =>
    withTestDb(async (db) => {
      const { caller } = await setup(db)
      const result = await caller.dashboard.overview()
      expect(result.open).toEqual({ count: 0, value: "0.0000" })
      expect(result.months).toHaveLength(12)
      expect(result.months.at(-1)!.month).toBe(day(0).slice(0, 8) + "01")
      expect(result.months.every((m) => m.count === 0)).toBe(true)
      expect(result.approvalQueue).toEqual({ total: 0, rows: [] })
      expect(result.currencyCode).toBe("USD")
    }))

  it("sums the open pipeline, leaving out customer outcomes", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      await quote("draft", { total: "100" })
      await quote("rejected", { total: "50.5" })
      await quote("pending_customer_approval", { total: "25" })
      await quote("customer_approved", { total: "300" })
      await quote("customer_rejected", { total: "70" })
      const { open } = await caller.dashboard.overview()
      expect(open).toEqual({ count: 3, value: "175.5000" })
    }))

  it("counts Quotes created per UTC month over the last twelve", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const now = new Date()
      const monthStart = (back: number) =>
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
      await quote("draft", { total: "10", createdAt: monthStart(0) })
      await quote("approved", { total: "20", createdAt: new Date() })
      await quote("draft", {
        total: "5",
        createdAt: new Date(monthStart(0).getTime() - 1000),
      })
      await quote("draft", { total: "7", createdAt: monthStart(11) })
      // Too old for the chart.
      await quote("draft", {
        total: "99",
        createdAt: new Date(monthStart(11).getTime() - 1000),
      })
      const { months } = await caller.dashboard.overview()
      expect(months.at(-1)).toEqual({
        month: monthStart(0).toISOString().slice(0, 10),
        count: 2,
        value: "30.0000",
      })
      expect(months.at(-2)).toMatchObject({ count: 1, value: "5.0000" })
      expect(months[0]).toEqual({
        month: monthStart(11).toISOString().slice(0, 10),
        count: 1,
        value: "7.0000",
      })
      expect(months.reduce((n, m) => n + m.count, 0)).toBe(4)
    }))

  it("queues what waits for an Approver, and a Member's own pending Quotes", () =>
    withTestDb(async (db) => {
      const { caller, asApprover, approver, quote, submitted } = await setup(db)
      const recent = await quote("pending_approval", { name: "Recent" })
      const old = await quote("pending_approval", { name: "Old" })
      const own = await quote("pending_approval", {
        name: "Approver's own",
        owner: approver,
      })
      await submitted(recent.id, 1)
      await submitted(old.id, 9)
      await submitted(own.id, 4)
      await quote("draft")

      const member = await caller.dashboard.overview()
      expect(member.isApprover).toBe(false)
      expect(member.approvalQueue.total).toBe(2)
      expect(member.approvalQueue.rows.map((r) => r.name)).toEqual([
        "Old",
        "Recent",
      ])
      expect(member.approvalQueue.rows[0]).toMatchObject({
        ageDays: 9,
        account: { name: "Initech" },
      })

      const approverView = await asApprover.dashboard.overview()
      expect(approverView.isApprover).toBe(true)
      expect(approverView.approvalQueue.total).toBe(2)
      expect(approverView.approvalQueue.rows.map((r) => r.name)).toEqual([
        "Old",
        "Recent",
      ])
    }))

  it("counts only this Organization's Quotes, and refuses non-members", () =>
    withTestDb(async (db) => {
      const { organization, caller, asApprover, quote } = await setup(db)
      await quote("draft", { total: "100" })
      const globex = await createOrganization(db)
      const { user: outsider } = await createMember(db, globex, {
        isApprover: true,
      })
      for (const status of [
        "pending_approval",
        "draft",
        "customer_approved",
      ] as const) {
        await createQuote(db, globex, {
          owner: outsider,
          status,
          total: "5000",
          marginPct: "1",
          validUntil: day(1),
        })
      }
      const result = await caller.dashboard.overview()
      expect(result.open).toEqual({ count: 1, value: "100.0000" })
      expect(result.months.reduce((n, m) => n + m.count, 0)).toBe(1)
      expect((await asApprover.dashboard.overview()).approvalQueue.total).toBe(
        0
      )

      await expect(
        organizationCaller(db, {
          organization,
          user: outsider,
        }).dashboard.overview()
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(
        organizationCaller(db, {
          organization,
          user: await createUser(db),
        }).dashboard.overview()
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})
