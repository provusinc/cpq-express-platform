import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import type { QuoteStage } from "@workspace/domain/enums"
import { QUOTE_STATUSES_PER_STAGE_MAX } from "@workspace/domain/stages"

import {
  createApprovalStep,
  createCustomer,
  createMember,
  createOrganization,
  createQuote,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const { quoteStatuses, quotes, approvalSteps } = schema

/** An Organization with an Admin, and that Admin's caller. */
async function adminOf(db: Db) {
  const acme = await createOrganization(db)
  const { user } = await createMember(db, acme, { role: "admin" })
  return {
    acme,
    admin: user,
    caller: organizationCaller(db, { organization: acme, user }),
  }
}

type Caller = Awaited<ReturnType<typeof adminOf>>["caller"]

const stageStatuses = async (caller: Caller, stage: QuoteStage) =>
  (await caller.settings.quoteStatuses()).filter((s) => s.stage === stage)

describe("settings.quoteStatuses", () => {
  it("lists every Status with the number of Quotes on it, for any member", () =>
    withTestDb(async (db) => {
      const { acme, admin } = await adminOf(db)
      const { user: member } = await createMember(db, acme)
      await createQuote(db, acme, { owner: admin })
      await createQuote(db, acme, { owner: admin })
      const statuses = await organizationCaller(db, {
        organization: acme,
        user: member,
      }).settings.quoteStatuses()
      expect(statuses.map((s) => [s.stage, s.name, s.quoteCount])).toEqual([
        ["draft", "Draft", 2],
        ["in_approval", "Pending Approval", 0],
        ["approved", "Approved", 0],
        ["with_customer", "Sent", 0],
        ["won", "Won", 0],
        ["lost", "Lost", 0],
      ])
    }))
})

describe("settings.createQuoteStatus", () => {
  it("adds a Status at the end of its Stage, trimmed and with a colour", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const created = await caller.settings.createQuoteStatus({
        stage: "in_approval",
        name: "  Legal review ",
        colour: "#D73434",
      })
      expect(created).toMatchObject({
        stage: "in_approval",
        name: "Legal review",
        colour: "#d73434",
        sequence: 1,
        quoteCount: 0,
      })
      expect(
        (await stageStatuses(caller, "in_approval")).map((s) => s.name)
      ).toEqual(["Pending Approval", "Legal review"])
    }))

  it(`allows at most ${QUOTE_STATUSES_PER_STAGE_MAX} Statuses per Stage`, () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      for (let i = 1; i < QUOTE_STATUSES_PER_STAGE_MAX; i++) {
        await caller.settings.createQuoteStatus({
          stage: "draft",
          name: `Draft ${i}`,
        })
      }
      await expect(
        caller.settings.createQuoteStatus({ stage: "draft", name: "One more" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      // Other Stages are unaffected.
      await caller.settings.createQuoteStatus({ stage: "won", name: "Signed" })
    }))

  it("refuses a name already used in the Organization, ignoring case and spaces", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      await expect(
        caller.settings.createQuoteStatus({ stage: "lost", name: " sent " })
      ).rejects.toMatchObject({ code: "CONFLICT" })
    }))

  it("refuses a blank or too long name and a colour outside the tones", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      for (const input of [
        { name: "   " },
        { name: "x".repeat(41) },
        { name: "Legal", colour: "#123456" },
      ]) {
        await expect(
          caller.settings.createQuoteStatus({ stage: "draft", ...input })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
    }))

  it.each(["manager", "member"] as const)("refuses a %s", (role) =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme, { role })
      await expect(
        organizationCaller(db, {
          organization: acme,
          user,
        }).settings.createQuoteStatus({ stage: "draft", name: "Legal" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    })
  )
})

describe("settings.updateQuoteStatus", () => {
  it("renames the Status everywhere it is read, but not in approval history", () =>
    withTestDb(async (db) => {
      const { acme, admin, caller } = await adminOf(db)
      const [draft] = await stageStatuses(caller, "draft")
      const quote = await createQuote(db, acme, { owner: admin })
      await createApprovalStep(db, quote, { action: "reopen", actor: admin })

      await caller.settings.updateQuoteStatus({
        id: draft!.id,
        name: "Drafting",
        colour: "#1447e6",
      })

      expect(await caller.quote.byId({ id: quote.id })).toMatchObject({
        status: { id: draft!.id, name: "Drafting", colour: "#1447e6" },
      })
      const list = await caller.quote.list({ page: 1, pageSize: 10 })
      expect(list.rows[0]?.status.name).toBe("Drafting")
      const [step] = await db
        .select()
        .from(approvalSteps)
        .where(eq(approvalSteps.quoteId, quote.id))
      expect(step?.toStatusName).toBe("Draft")
      const history = await caller.quote.approvalHistory({ id: quote.id })
      expect(history.steps[0]).toMatchObject({ toStatusName: "Draft" })
    }))

  it("keeps its own name (in another case) and clears the colour with null", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const [sent] = await stageStatuses(caller, "with_customer")
      await caller.settings.updateQuoteStatus({
        id: sent!.id,
        colour: "#6a59cb",
      })
      const updated = await caller.settings.updateQuoteStatus({
        id: sent!.id,
        name: "SENT",
        colour: null,
      })
      expect(updated).toMatchObject({ name: "SENT", colour: null })
    }))

  it("refuses another Status's name", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const [won] = await stageStatuses(caller, "won")
      await expect(
        caller.settings.updateQuoteStatus({ id: won!.id, name: "lost" })
      ).rejects.toMatchObject({ code: "CONFLICT" })
    }))

  it("lets the last Status of a Stage be renamed", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const [lost] = await stageStatuses(caller, "lost")
      await expect(
        caller.settings.updateQuoteStatus({ id: lost!.id, name: "Closed lost" })
      ).resolves.toMatchObject({ name: "Closed lost" })
    }))
})

describe("settings.reorderQuoteStatuses", () => {
  it("reorders a Stage; its first Status becomes the entry Status", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await adminOf(db)
      const [draft] = await stageStatuses(caller, "draft")
      const idea = await caller.settings.createQuoteStatus({
        stage: "draft",
        name: "Idea",
      })
      await caller.settings.reorderQuoteStatuses({
        stage: "draft",
        ids: [idea.id, draft!.id],
      })
      expect(
        (await stageStatuses(caller, "draft")).map((s) => [s.name, s.sequence])
      ).toEqual([
        ["Idea", 0],
        ["Draft", 1],
      ])
      const customer = await createCustomer(db, acme)
      const created = await caller.quote.create({
        customerId: customer.id,
        name: "New",
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        timePeriod: "months",
      })
      expect(await caller.quote.byId({ id: created.id })).toMatchObject({
        status: { name: "Idea" },
      })
    }))

  it("requires exactly the Stage's Statuses", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const [draft] = await stageStatuses(caller, "draft")
      const [won] = await stageStatuses(caller, "won")
      const idea = await caller.settings.createQuoteStatus({
        stage: "draft",
        name: "Idea",
      })
      for (const ids of [
        [idea.id],
        [idea.id, idea.id],
        [idea.id, draft!.id, won!.id],
        [idea.id, won!.id],
      ]) {
        await expect(
          caller.settings.reorderQuoteStatuses({ stage: "draft", ids })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
    }))
})

describe("settings.deleteQuoteStatus", () => {
  it("deletes an unused Status without a replacement", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const legal = await caller.settings.createQuoteStatus({
        stage: "in_approval",
        name: "Legal",
      })
      expect(
        await caller.settings.deleteQuoteStatus({ id: legal.id })
      ).toMatchObject({ moved: 0 })
      expect(await stageStatuses(caller, "in_approval")).toHaveLength(1)
    }))

  it("never deletes the last Status of a Stage", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const [won] = await stageStatuses(caller, "won")
      await expect(
        caller.settings.deleteQuoteStatus({ id: won!.id })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    }))

  it("moves the Quotes of a Status in use to the replacement, without Approval Steps", () =>
    withTestDb(async (db) => {
      const { acme, admin, caller } = await adminOf(db)
      const [draft] = await stageStatuses(caller, "draft")
      const idea = await caller.settings.createQuoteStatus({
        stage: "draft",
        name: "Idea",
      })
      const moving = [
        await createQuote(db, acme, { owner: admin }),
        await createQuote(db, acme, { owner: admin }),
      ]
      const other = await createQuote(db, acme, {
        owner: admin,
        statusId: idea.id,
      })

      await expect(
        caller.settings.deleteQuoteStatus({ id: draft!.id })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })

      expect(
        await caller.settings.deleteQuoteStatus({
          id: draft!.id,
          replacementId: idea.id,
        })
      ).toMatchObject({ moved: 2, replacementId: idea.id })
      const rows = await db
        .select({
          id: quotes.id,
          statusId: quotes.statusId,
          stage: quotes.stage,
        })
        .from(quotes)
        .where(eq(quotes.organizationId, acme.id))
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        expect(row).toMatchObject({ statusId: idea.id, stage: "draft" })
      }
      expect(rows.map((r) => r.id).sort()).toEqual(
        [...moving, other].map((q) => q.id).sort()
      )
      expect(
        await db
          .select()
          .from(approvalSteps)
          .where(eq(approvalSteps.organizationId, acme.id))
      ).toHaveLength(0)
      expect((await stageStatuses(caller, "draft")).map((s) => s.name)).toEqual(
        ["Idea"]
      )
    }))

  it("refuses a replacement in another Stage, or the Status itself", () =>
    withTestDb(async (db) => {
      const { acme, admin, caller } = await adminOf(db)
      const [draft] = await stageStatuses(caller, "draft")
      const [lost] = await stageStatuses(caller, "lost")
      await caller.settings.createQuoteStatus({ stage: "draft", name: "Idea" })
      await createQuote(db, acme, { owner: admin })
      for (const replacementId of [lost!.id, draft!.id]) {
        await expect(
          caller.settings.deleteQuoteStatus({ id: draft!.id, replacementId })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
      expect(await stageStatuses(caller, "draft")).toHaveLength(2)
    }))
})

describe("Quote Status settings isolation", () => {
  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { acme, admin, caller } = await adminOf(db)
      const [draft] = await stageStatuses(caller, "draft")
      const idea = await caller.settings.createQuoteStatus({
        stage: "draft",
        name: "Idea",
      })
      await createQuote(db, acme, { owner: admin })
      const snapshot = async () => ({
        statuses: await db
          .select()
          .from(quoteStatuses)
          .where(eq(quoteStatuses.organizationId, acme.id))
          .orderBy(quoteStatuses.id),
        quotes: await db
          .select({ id: quotes.id, statusId: quotes.statusId })
          .from(quotes)
          .where(eq(quotes.organizationId, acme.id)),
      })
      const calls: ((c: Caller) => Promise<unknown>)[] = [
        (c) => c.settings.updateQuoteStatus({ id: idea.id, name: "Hacked" }),
        (c) =>
          c.settings.reorderQuoteStatuses({
            stage: "draft",
            ids: [idea.id, draft!.id],
          }),
        (c) => c.settings.deleteQuoteStatus({ id: idea.id }),
        (c) =>
          c.settings.deleteQuoteStatus({
            id: draft!.id,
            replacementId: idea.id,
          }),
      ]
      for (const call of calls) {
        await expectIsolated(db, { owner: acme, call, snapshot })
      }
    }))

  it("refuses a replacement from another Organization", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const other = await adminOf(db)
      const [theirs] = await stageStatuses(other.caller, "draft")
      const idea = await caller.settings.createQuoteStatus({
        stage: "draft",
        name: "Idea",
      })
      await expect(
        caller.settings.deleteQuoteStatus({
          id: idea.id,
          replacementId: theirs!.id,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("creates only in the caller's Organization and refuses non-members", () =>
    withTestDb(async (db) => {
      const { acme } = await adminOf(db)
      const outsider = await createOrganization(db)
      const { user } = await createMember(db, outsider, { role: "admin" })
      await expect(
        organizationCaller(db, {
          organization: acme,
          user,
        }).settings.createQuoteStatus({ stage: "draft", name: "Hacked" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(
        organizationCaller(db, {
          organization: acme,
          user,
        }).settings.quoteStatuses()
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})
