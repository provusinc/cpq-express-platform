import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import type { QuoteStatus } from "@workspace/domain/enums"
import type { InsightKey } from "@workspace/domain/insights"

import {
  createMember,
  createOrganization,
  createQuote,
  organizationCaller,
  withTestDb,
} from "../test"

const DAY_MS = 86_400_000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS)

/** An Organization with a Member (the caller) and an Approver. */
async function setup(db: Db) {
  const organization = await createOrganization(db)
  const { user } = await createMember(db, organization, { role: "member" })
  const { user: approver } = await createMember(db, organization, {
    isApprover: true,
  })
  const caller = organizationCaller(db, { organization, user })
  /** A Quote owned by the Member with the given status and totals. */
  const quote = (
    status: QuoteStatus,
    fields: {
      total?: string
      marginPct?: string
      createdAt?: Date
      validUntil?: string | null
    } = {}
  ) =>
    createQuote(db, organization, {
      owner: user,
      status,
      total: fields.total ?? "1000",
      marginPct: fields.marginPct ?? "40",
      ...(fields.createdAt ? { createdAt: fields.createdAt } : {}),
      ...(fields.validUntil !== undefined
        ? { validUntil: fields.validUntil }
        : {}),
    })
  /** Records a submit Approval Step `days` ago. */
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
  return { organization, user, approver, caller, quote, submitted }
}

const card = <C extends { key: InsightKey }>(
  result: { cards: C[] },
  key: InsightKey
) => result.cards.find((c) => c.key === key)!

describe("quote.insights", () => {
  it("returns every card at zero for an Organization without Quotes", () =>
    withTestDb(async (db) => {
      const { caller } = await setup(db)
      const result = await caller.quote.insights()
      expect(result.cards.map((c) => c.key)).toEqual([
        "pending_approval",
        "high_value_pipeline",
        "low_margin",
        "valid_until_soon",
        "this_month",
        "rejected",
      ])
      for (const c of result.cards) {
        expect(c).toMatchObject({
          count: 0,
          value: "0.0000",
          severity: "info",
        })
      }
      expect(card(result, "pending_approval")).toMatchObject({
        oldestAgeDays: null,
        oldestSubmittedAt: null,
      })
      expect(result.currencyCode).toBe("USD")
      expect(Object.values(result.statusCounts)).toEqual([0, 0, 0, 0, 0, 0, 0])
      expect(result.recent).toEqual([])
    }))

  it("counts Pending Approval Quotes, their value and the oldest wait from the latest submit step", () =>
    withTestDb(async (db) => {
      const { caller, quote, submitted } = await setup(db)
      const a = await quote("pending_approval", { total: "100.5" })
      // Submitted 10 days ago, rejected, then resubmitted 4 days ago.
      await submitted(a.id, 10)
      await submitted(a.id, 4)
      await quote("draft", { total: "999" })
      const result = await caller.quote.insights()
      expect(card(result, "pending_approval")).toMatchObject({
        count: 1,
        value: "100.5000",
        oldestAgeDays: 4,
        severity: "warning",
      })
      const oldest = card(result, "pending_approval").oldestSubmittedAt!
      expect(Math.abs(oldest.getTime() - daysAgo(4).getTime())).toBeLessThan(
        60_000
      )
    }))

  it.each([
    // [Quotes pending, days the oldest has waited, severity]
    [1, 0, "info"],
    [1, 2, "info"],
    [1, 3, "warning"],
    [2, 0, "warning"],
    [4, 6, "warning"],
    [1, 7, "critical"],
    [5, 0, "critical"],
  ] as const)(
    "pending approval with %i Quotes, oldest %i days → %s",
    (n, days, severity) =>
      withTestDb(async (db) => {
        const { caller, quote, submitted } = await setup(db)
        for (let i = 0; i < n; i++) {
          const q = await quote("pending_approval")
          await submitted(q.id, i === 0 ? days : 0)
        }
        expect(
          card(await caller.quote.insights(), "pending_approval")
        ).toMatchObject({ count: n, oldestAgeDays: days, severity })
      })
  )

  it("counts Draft + Pending Approval as the pipeline", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      await quote("draft", { total: "100" })
      await quote("draft", { total: "200" })
      await quote("pending_approval", { total: "300" })
      await quote("approved", { total: "5000" })
      await quote("rejected", { total: "5000" })
      await quote("pending_customer_approval", { total: "5000" })
      expect(
        card(await caller.quote.insights(), "high_value_pipeline")
      ).toMatchObject({ count: 3, value: "600.0000", severity: "info" })
    }))

  it("counts low-margin Quotes: Margin % < 15, Total > 0, not decided", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      await quote("draft", { total: "100", marginPct: "14.9999" })
      await quote("pending_approval", { total: "200", marginPct: "-5" })
      await quote("pending_customer_approval", { total: "300", marginPct: "0" })
      // Not counted: at the threshold, no Total, or decided.
      await quote("draft", { total: "100", marginPct: "15" })
      await quote("draft", { total: "0", marginPct: "0" })
      for (const status of [
        "approved",
        "rejected",
        "customer_approved",
        "customer_rejected",
      ] as const) {
        await quote(status, { total: "100", marginPct: "5" })
      }
      expect(card(await caller.quote.insights(), "low_margin")).toMatchObject({
        count: 3,
        value: "600.0000",
        severity: "warning",
      })
    }))

  it("counts offers in play whose Valid Until is within 14 days", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const day = (offset: number) =>
        new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10)
      await quote("draft", { total: "10", validUntil: day(0) })
      await quote("approved", { total: "20", validUntil: day(7) })
      await quote("pending_customer_approval", {
        total: "30",
        validUntil: day(14),
      })
      // Not counted: passed, too far out, none, or no longer in play.
      await quote("draft", { total: "1", validUntil: day(-1) })
      await quote("draft", { total: "1", validUntil: day(15) })
      await quote("draft", { total: "1", validUntil: null })
      await quote("rejected", { total: "1", validUntil: day(3) })
      await quote("customer_approved", { total: "1", validUntil: day(3) })
      const result = await caller.quote.insights()
      expect(result.today).toBe(day(0))
      expect(card(result, "valid_until_soon")).toMatchObject({
        count: 3,
        value: "60.0000",
        severity: "warning",
      })
    }))

  it("counts Quotes created since the start of this UTC month", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const now = new Date()
      const monthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      )
      await quote("draft", { total: "10" })
      await quote("approved", { total: "20", createdAt: monthStart })
      await quote("draft", {
        total: "99",
        createdAt: new Date(monthStart.getTime() - 1000),
      })
      const result = await caller.quote.insights()
      expect(result.thisMonthFrom).toBe(monthStart.toISOString().slice(0, 10))
      expect(card(result, "this_month")).toMatchObject({
        count: 2,
        value: "30.0000",
        severity: "info",
      })
    }))

  it.each([
    [2, "info"],
    [3, "warning"],
  ] as const)("counts Rejected + Customer Rejected (%i → %s)", (n, severity) =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      await quote("customer_rejected", { total: "50" })
      for (let i = 1; i < n; i++) await quote("rejected", { total: "50" })
      await quote("approved")
      expect(card(await caller.quote.insights(), "rejected")).toMatchObject({
        count: n,
        value: (50 * n).toFixed(4),
        severity,
      })
    })
  )

  it("counts every status", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      await quote("draft")
      await quote("draft")
      await quote("approved")
      await quote("customer_rejected")
      expect((await caller.quote.insights()).statusCounts).toEqual({
        draft: 2,
        pending_approval: 0,
        approved: 1,
        rejected: 0,
        pending_customer_approval: 0,
        customer_approved: 0,
        customer_rejected: 1,
      })
    }))

  it("lists the caller's recent Quotes (created or last changed by them), most recently changed first", () =>
    withTestDb(async (db) => {
      const { organization, user, caller, approver } = await setup(db)
      const mine = []
      for (let i = 0; i < 6; i++) {
        mine.push(
          await createQuote(db, organization, {
            owner: user,
            name: `Q${i}`,
            updatedAt: daysAgo(10 - i),
          })
        )
      }
      // Someone else's Quote that the caller changed last counts…
      const edited = await createQuote(db, organization, { owner: approver })
      await db
        .update(schema.quotes)
        .set({ updatedById: user.id })
        .where(eq(schema.quotes.id, edited.id))
      // …one they never touched doesn't.
      await createQuote(db, organization, { owner: approver })
      const recent = (await caller.quote.insights()).recent
      expect(recent.map((q) => q.id)).toEqual([
        edited.id,
        mine[5]!.id,
        mine[4]!.id,
        mine[3]!.id,
        mine[2]!.id,
      ])
      expect(recent[1]).toMatchObject({
        name: "Q5",
        status: "draft",
        currencyCode: "USD",
        customer: { id: mine[5]!.customerId },
      })
    }))

  it("counts only this Organization's Quotes, and refuses non-members", () =>
    withTestDb(async (db) => {
      const { organization, caller, quote } = await setup(db)
      await quote("pending_approval", { total: "100" })
      const globex = await createOrganization(db)
      const { user: outsider } = await createMember(db, globex)
      for (const status of [
        "pending_approval",
        "draft",
        "rejected",
        "rejected",
        "rejected",
      ] as const) {
        await createQuote(db, globex, {
          owner: outsider,
          status,
          total: "5000",
          marginPct: "1",
        })
      }
      const result = await caller.quote.insights()
      expect(card(result, "pending_approval")).toMatchObject({
        count: 1,
        value: "100.0000",
      })
      expect(card(result, "rejected").count).toBe(0)
      expect(card(result, "low_margin").count).toBe(0)
      expect(result.statusCounts.draft).toBe(0)
      await expect(
        organizationCaller(db, {
          organization,
          user: outsider,
        }).quote.insights()
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})

describe("quote.list marginBelow", () => {
  it("lists Quotes below the Margin % with a positive Total", () =>
    withTestDb(async (db) => {
      const { caller, organization, user } = await setup(db)
      const make = (name: string, total: string, marginPct: string) =>
        createQuote(db, organization, { owner: user, name, total, marginPct })
      await make("Thin", "100", "10")
      await make("Negative", "100", "-3")
      await make("At threshold", "100", "15")
      await make("Empty", "0", "0")
      const result = await caller.quote.list({
        marginBelow: "15",
        sort: { by: "name", direction: "asc" },
      })
      expect(result.rows.map((r) => r.name)).toEqual(["Negative", "Thin"])
      expect(result.total).toBe(2)
    }))
})
