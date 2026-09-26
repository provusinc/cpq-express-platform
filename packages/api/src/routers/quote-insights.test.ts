import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import type { QuoteStage } from "@workspace/domain/enums"
import type { InsightKey } from "@workspace/domain/insights"

import {
  createApprovalStep,
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
  /**
   * A Quote owned by the Member in the given Stage with the given totals;
   * `rejected` / `customer_rejected` is a Draft whose latest Approval Step
   * is that rejection.
   */
  const quote = async (
    state: QuoteStage | "rejected" | "customer_rejected",
    fields: {
      total?: string
      marginPct?: string
      createdAt?: Date
      validUntil?: string | null
    } = {}
  ) => {
    const rejection =
      state === "rejected"
        ? "reject"
        : state === "customer_rejected"
          ? "customer_rejected"
          : null
    const row = await createQuote(db, organization, {
      owner: user,
      stage: rejection ? "draft" : (state as QuoteStage),
      total: fields.total ?? "1000",
      marginPct: fields.marginPct ?? "40",
      ...(fields.createdAt ? { createdAt: fields.createdAt } : {}),
      ...(fields.validUntil !== undefined
        ? { validUntil: fields.validUntil }
        : {}),
    })
    if (rejection) {
      await createApprovalStep(db, row, { action: rejection, actor: approver })
    }
    return row
  }
  /** Records a submit Approval Step `days` ago. */
  const submitted = (quoteId: string, days: number) =>
    createApprovalStep(
      db,
      { id: quoteId, organizationId: organization.id },
      { action: "submit", actor: user, createdAt: daysAgo(days) }
    )
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
      expect(Object.values(result.stageCounts)).toEqual([0, 0, 0, 0, 0, 0])
      expect(result.recent).toEqual([])
    }))

  it("counts Quotes In Approval, their value and the oldest wait from the latest submit step", () =>
    withTestDb(async (db) => {
      const { caller, quote, submitted } = await setup(db)
      const a = await quote("in_approval", { total: "100.5" })
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
          const q = await quote("in_approval")
          await submitted(q.id, i === 0 ? days : 0)
        }
        expect(
          card(await caller.quote.insights(), "pending_approval")
        ).toMatchObject({ count: n, oldestAgeDays: days, severity })
      })
  )

  it("counts Draft (Rejected included) + In Approval as the pipeline", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      await quote("draft", { total: "100" })
      await quote("rejected", { total: "200" })
      await quote("in_approval", { total: "300" })
      await quote("approved", { total: "5000" })
      await quote("with_customer", { total: "5000" })
      await quote("won", { total: "5000" })
      await quote("lost", { total: "5000" })
      expect(
        card(await caller.quote.insights(), "high_value_pipeline")
      ).toMatchObject({ count: 3, value: "600.0000", severity: "info" })
    }))

  it("counts low-margin Quotes: Margin % < 15, Total > 0, not Decided", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      await quote("draft", { total: "100", marginPct: "14.9999" })
      await quote("in_approval", { total: "200", marginPct: "-5" })
      // A Rejected Quote is back in Draft: not Decided.
      await quote("customer_rejected", { total: "300", marginPct: "0" })
      // Not counted: at the threshold, no Total, or Decided.
      await quote("draft", { total: "100", marginPct: "15" })
      await quote("draft", { total: "0", marginPct: "0" })
      for (const stage of [
        "approved",
        "with_customer",
        "won",
        "lost",
      ] as const) {
        await quote(stage, { total: "100", marginPct: "5" })
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
      await quote("with_customer", { total: "30", validUntil: day(14) })
      // Not counted: passed, too far out, none, or no longer in play.
      await quote("draft", { total: "1", validUntil: day(-1) })
      await quote("draft", { total: "1", validUntil: day(15) })
      await quote("draft", { total: "1", validUntil: null })
      await quote("won", { total: "1", validUntil: day(3) })
      await quote("lost", { total: "1", validUntil: day(3) })
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
  ] as const)(
    "counts Rejected Quotes, by an Approver or the customer (%i → %s)",
    (n, severity) =>
      withTestDb(async (db) => {
        const { caller, quote, submitted } = await setup(db)
        await quote("customer_rejected", { total: "50" })
        for (let i = 1; i < n; i++) await quote("rejected", { total: "50" })
        await quote("approved")
        await quote("draft")
        // Resubmitted after a rejection: no longer Rejected.
        const resubmitted = await quote("rejected", { total: "999" })
        await submitted(resubmitted.id, 0)
        expect(card(await caller.quote.insights(), "rejected")).toMatchObject({
          count: n,
          value: (50 * n).toFixed(4),
          severity,
        })
      })
  )

  it("counts every Stage", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      await quote("draft")
      await quote("draft")
      await quote("approved")
      await quote("customer_rejected")
      await quote("won")
      expect((await caller.quote.insights()).stageCounts).toEqual({
        draft: 3,
        in_approval: 0,
        approved: 1,
        with_customer: 0,
        won: 1,
        lost: 0,
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
        stage: "draft",
        status: { name: "Draft" },
        rejected: false,
        currencyCode: "USD",
        customer: { id: mine[5]!.customerId },
      })
    }))

  it("counts only this Organization's Quotes, and refuses non-members", () =>
    withTestDb(async (db) => {
      const { organization, caller, quote } = await setup(db)
      await quote("in_approval", { total: "100" })
      const globex = await createOrganization(db)
      const { user: outsider } = await createMember(db, globex)
      for (const stage of ["in_approval", "draft", "draft", "draft"] as const) {
        const theirs = await createQuote(db, globex, {
          owner: outsider,
          stage,
          total: "5000",
          marginPct: "1",
        })
        if (stage === "draft") {
          await createApprovalStep(db, theirs, {
            action: "reject",
            actor: outsider,
          })
        }
      }
      const result = await caller.quote.insights()
      expect(card(result, "pending_approval")).toMatchObject({
        count: 1,
        value: "100.0000",
      })
      expect(card(result, "rejected").count).toBe(0)
      expect(card(result, "low_margin").count).toBe(0)
      expect(result.stageCounts.draft).toBe(0)
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
