import { describe, expect, it } from "vitest"

import { schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import { VALUE_RANGES, valueBuckets } from "@workspace/domain/dashboard"
import type { QuoteStatus } from "@workspace/domain/enums"

import {
  createCustomer,
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
  const customer = await createCustomer(db, organization, { name: "Initech" })
  const caller = organizationCaller(db, { organization, user })
  const asApprover = organizationCaller(db, { organization, user: approver })
  const quote = (
    status: QuoteStatus,
    fields: Partial<typeof schema.quotes.$inferInsert> & {
      owner?: { id: string }
      customer?: { id: string }
    } = {}
  ) =>
    createQuote(db, organization, {
      owner: fields.owner ?? user,
      customer: fields.customer ?? customer,
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
    customer,
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
        customer: { name: "Initech" },
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

describe("dashboard.valueOverTime", () => {
  it("is every bucket of the range, zero-filled, oldest first", () =>
    withTestDb(async (db) => {
      const { caller } = await setup(db)
      for (const range of VALUE_RANGES) {
        const result = await caller.dashboard.valueOverTime({ range })
        const expected = valueBuckets(Date.now(), range)
        expect(result.range).toBe(range)
        expect(result.unit).toBe(expected.unit)
        expect(result.buckets.map((b) => b.start)).toEqual(expected.starts)
        expect(result.buckets[0]).toEqual({
          start: expected.from,
          created: { count: 0, value: "0.0000" },
          approved: { count: 0, value: "0.0000" },
        })
      }
    }))

  it("sums created Quotes by UTC day, leaving out older ones", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const today = new Date(`${day(0)}T00:00:00.000Z`)
      await quote("draft", { total: "10", createdAt: today })
      await quote("customer_approved", { total: "20", createdAt: new Date() })
      // The last second of yesterday (UTC).
      await quote("draft", {
        total: "5",
        createdAt: new Date(today.getTime() - 1000),
      })
      // Six days ago is the first day of "7d"; seven is outside it.
      await quote("draft", { total: "7", createdAt: daysAgo(6) })
      await quote("draft", { total: "99", createdAt: daysAgo(7.5) })

      const { buckets } = await caller.dashboard.valueOverTime({ range: "7d" })
      expect(buckets).toHaveLength(7)
      expect(buckets.at(-1)!.created).toEqual({ count: 2, value: "30.0000" })
      expect(buckets.at(-2)!.created).toEqual({ count: 1, value: "5.0000" })
      expect(buckets[0]!.created).toEqual({ count: 1, value: "7.0000" })
      expect(buckets.reduce((n, b) => n + b.created.count, 0)).toBe(4)
      // Created isn't Customer Approved: that needs its Approval Step.
      expect(buckets.every((b) => b.approved.count === 0)).toBe(true)
    }))

  it("dates Customer Approved by its Approval Step, in weeks", () =>
    withTestDb(async (db) => {
      const { organization, user, caller, quote } = await setup(db)
      const won = await quote("customer_approved", {
        total: "300",
        createdAt: daysAgo(200),
      })
      const other = await quote("customer_approved", {
        total: "50.5",
        createdAt: daysAgo(20),
      })
      const lost = await quote("customer_rejected", { total: "999" })
      const step = (quoteId: string, toStatus: QuoteStatus, at: Date) =>
        db.insert(schema.approvalSteps).values({
          organizationId: organization.id,
          quoteId,
          action:
            toStatus === "customer_approved"
              ? "customer_approved"
              : "customer_rejected",
          fromStatus: "pending_customer_approval",
          toStatus,
          actorId: user.id,
          createdAt: at,
        })
      await step(won.id, "customer_approved", new Date())
      await step(other.id, "customer_approved", new Date())
      await step(lost.id, "customer_rejected", new Date())

      const result = await caller.dashboard.valueOverTime({ range: "90d" })
      expect(result.unit).toBe("week")
      expect(result.buckets).toHaveLength(13)
      expect(result.buckets.at(-1)!.approved).toEqual({
        count: 2,
        value: "350.5000",
      })
      expect(result.buckets.at(-1)!.start).toBe(
        valueBuckets(Date.now(), "90d").last
      )
      // `won` was created before the range; `other` and `lost` in it.
      expect(result.buckets.reduce((n, b) => n + b.created.count, 0)).toBe(2)
    }))

  it("counts only this Organization's Quotes, and refuses non-members", () =>
    withTestDb(async (db) => {
      const { organization, caller, quote } = await setup(db)
      await quote("draft", { total: "100" })
      const globex = await createOrganization(db)
      const { user: outsider } = await createMember(db, globex)
      const theirs = await createQuote(db, globex, {
        owner: outsider,
        status: "customer_approved",
        total: "5000",
        marginPct: "1",
      })
      await db.insert(schema.approvalSteps).values({
        organizationId: globex.id,
        quoteId: theirs.id,
        action: "customer_approved",
        fromStatus: "pending_customer_approval",
        toStatus: "customer_approved",
        actorId: outsider.id,
      })

      const { buckets } = await caller.dashboard.valueOverTime({ range: "30d" })
      expect(buckets.at(-1)!.created).toEqual({ count: 1, value: "100.0000" })
      expect(buckets.every((b) => b.approved.count === 0)).toBe(true)

      await expect(
        organizationCaller(db, {
          organization,
          user: outsider,
        }).dashboard.valueOverTime({ range: "30d" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("refuses an unknown range", () =>
    withTestDb(async (db) => {
      const { caller } = await setup(db)
      await expect(
        caller.dashboard.valueOverTime({ range: "1y" as never })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))
})
