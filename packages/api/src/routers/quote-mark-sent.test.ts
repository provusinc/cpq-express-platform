/**
 * Mark as Sent and the customer outcome (#22): the transitions and their
 * Approval Steps, the captured Quote Document (flagged, stored, in the
 * Quote's version sequence, undeletable), atomicity when storage fails,
 * who may act, Valid Until never changing status, and isolation.
 */
import { describe, expect, it } from "vitest"

import { asc, eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import type { QuoteStatus } from "@workspace/domain/enums"
import {
  createMemoryStorage,
  isOrganizationObjectKey,
} from "@workspace/storage"
import type { ObjectStorage } from "@workspace/storage"

import { QUOTE_DOCUMENT_AREA } from "../documents"
import {
  createMember,
  createOrganization,
  createQuote,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const { approvalSteps, quoteDocuments, quotes } = schema

/**
 * An Organization whose Member owns a Quote (Approved by default, positive
 * Total), plus an Admin, a Manager, another Member and an Approver, all
 * sharing one in-memory store.
 */
async function setup(
  db: Db,
  quote: { status?: QuoteStatus; validUntil?: string | null } = {},
  storage: ObjectStorage & {
    objects: Map<string, unknown>
  } = createMemoryStorage()
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
  }
  const caller = (who: keyof typeof members) =>
    organizationCaller(db, { organization, user: members[who].user, storage })
  const row = await createQuote(db, organization, {
    owner: members.owner.user,
    status: quote.status ?? "approved",
    total: "1000.0000",
    validUntil: quote.validUntil ?? null,
  })
  return { organization, members, caller, storage, quote: row }
}

const statusOf = async (db: Db, id: string) =>
  (await db.select().from(quotes).where(eq(quotes.id, id)))[0]!.status

const stepsOf = (db: Db, quoteId: string) =>
  db
    .select()
    .from(approvalSteps)
    .where(eq(approvalSteps.quoteId, quoteId))
    .orderBy(asc(approvalSteps.createdAt), asc(approvalSteps.id))

const documentsOf = (db: Db, quoteId: string) =>
  db
    .select()
    .from(quoteDocuments)
    .where(eq(quoteDocuments.quoteId, quoteId))
    .orderBy(asc(quoteDocuments.version))

describe("quote.markSent", () => {
  it("moves an Approved Quote to Pending Customer Approval, records the step and captures a Document", () =>
    withTestDb(async (db) => {
      const { caller, quote, members, storage, organization } = await setup(db)
      const result = await caller("owner").quote.markSent({
        id: quote.id,
        notes: "  Emailed to Bill  ",
      })
      expect(result).toMatchObject({
        id: quote.id,
        status: "pending_customer_approval",
        updatedById: members.owner.user.id,
        step: {
          action: "mark_sent",
          fromStatus: "approved",
          toStatus: "pending_customer_approval",
          comment: "Emailed to Bill",
        },
        document: {
          quoteId: quote.id,
          version: 1,
          capturedByMarkSent: true,
          notes: "Emailed to Bill",
          canDelete: false,
          generatedBy: { id: members.owner.user.id },
        },
      })
      expect(result.document).not.toHaveProperty("storageKey")
      expect(await statusOf(db, quote.id)).toBe("pending_customer_approval")

      const [row] = await documentsOf(db, quote.id)
      expect(row).toMatchObject({
        id: result.document.id,
        capturedByMarkSent: true,
        generatedById: members.owner.user.id,
      })
      expect(
        isOrganizationObjectKey(
          row!.storageKey,
          organization.id,
          QUOTE_DOCUMENT_AREA
        )
      ).toBe(true)
      expect(storage.objects.has(row!.storageKey)).toBe(true)
      expect(row!.fileSize).toBeGreaterThan(0)

      const steps = await stepsOf(db, quote.id)
      expect(steps.map((s) => s.action)).toEqual(["mark_sent"])
    }))

  it("continues the Quote's version sequence", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      await caller("otherMember").quoteDocument.generate({ quoteId: quote.id })
      await caller("otherMember").quoteDocument.generate({ quoteId: quote.id })
      const result = await caller("owner").quote.markSent({ id: quote.id })
      expect(result.document.version).toBe(3)
      const rows = await documentsOf(db, quote.id)
      expect(
        rows.map((r) => [r.version, r.capturedByMarkSent, r.notes])
      ).toEqual([
        [1, false, null],
        [2, false, null],
        [3, true, null],
      ])
    }))

  it("changes nothing when storing the Document fails", () =>
    withTestDb(async (db) => {
      const memory = createMemoryStorage()
      const failing = {
        ...memory,
        objects: memory.objects,
        put: async () => {
          throw new Error("S3 is down")
        },
      }
      const { caller, quote } = await setup(db, {}, failing)
      await expect(
        caller("owner").quote.markSent({ id: quote.id })
      ).rejects.toThrow()
      expect(await statusOf(db, quote.id)).toBe("approved")
      expect(await stepsOf(db, quote.id)).toEqual([])
      expect(await documentsOf(db, quote.id)).toEqual([])
      expect(memory.objects.size).toBe(0)
    }))

  it("leaves no stored object when the capture fails after the upload", () =>
    withTestDb(async (db) => {
      const memory = createMemoryStorage()
      let afterPut: (() => Promise<unknown>) | null = null
      const tripwire = {
        ...memory,
        objects: memory.objects,
        put: async (...args: Parameters<ObjectStorage["put"]>) => {
          await memory.put(...args)
          await afterPut?.()
        },
      }
      const { caller, quote, organization } = await setup(db, {}, tripwire)
      // A row taking the next version makes the capture's insert fail after
      // its PDF was stored.
      afterPut = () =>
        db.insert(quoteDocuments).values({
          organizationId: organization.id,
          quoteId: quote.id,
          version: 1,
          storageKey: "organizations/x/quote-documents/x.pdf",
          fileSize: 1,
          quoteSnapshot: {},
          settingsSnapshot: {},
          generatedById: quote.ownerId,
        })
      await expect(
        caller("owner").quote.markSent({ id: quote.id })
      ).rejects.toThrow()
      expect(memory.objects.size).toBe(0)
      expect(await statusOf(db, quote.id)).toBe("approved")
      expect(await stepsOf(db, quote.id)).toEqual([])
    }))

  it.each([
    "draft",
    "pending_approval",
    "rejected",
    "pending_customer_approval",
    "customer_approved",
    "customer_rejected",
  ] as const)("is refused from %s", (status) =>
    withTestDb(async (db) => {
      const { caller, quote, storage } = await setup(db, { status })
      await expect(
        caller("owner").quote.markSent({ id: quote.id })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      expect(await statusOf(db, quote.id)).toBe(status)
      expect(storage.objects.size).toBe(0)
    })
  )

  it("allows the Owner and an Admin; refuses a Manager, another Member and an Approver", () =>
    withTestDb(async (db) => {
      for (const who of ["manager", "otherMember", "approver"] as const) {
        const { caller, quote } = await setup(db)
        await expect(
          caller(who).quote.markSent({ id: quote.id })
        ).rejects.toMatchObject({ code: "FORBIDDEN" })
        expect(await statusOf(db, quote.id)).toBe("approved")
      }
      for (const who of ["owner", "admin"] as const) {
        const { caller, quote } = await setup(db)
        await expect(
          caller(who).quote.markSent({ id: quote.id })
        ).resolves.toMatchObject({ status: "pending_customer_approval" })
      }
    }))

  it("captures a Document nobody can delete", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const { document } = await caller("owner").quote.markSent({
        id: quote.id,
      })
      for (const who of ["owner", "admin"] as const) {
        await expect(
          caller(who).quoteDocument.delete({ id: document.id })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      }
      const list = await caller("admin").quoteDocument.list({
        quoteId: quote.id,
      })
      expect(list).toMatchObject([
        { id: document.id, capturedByMarkSent: true, canDelete: false },
      ])
      expect(await documentsOf(db, quote.id)).toHaveLength(1)
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.quote.markSent({ id: quote.id }),
        snapshot: async () => ({
          status: await statusOf(db, quote.id),
          documents: await documentsOf(db, quote.id),
        }),
      })
    }))
})

describe("quote.recordCustomerOutcome", () => {
  it.each([
    ["approved", "customer_approved"],
    ["rejected", "customer_rejected"],
  ] as const)("records the customer's %s answer as a step", (outcome, to) =>
    withTestDb(async (db) => {
      const { caller, quote, members } = await setup(db, {
        status: "pending_customer_approval",
      })
      const result = await caller("owner").quote.recordCustomerOutcome({
        id: quote.id,
        outcome,
        note: " Signed on the call ",
      })
      expect(result).toMatchObject({
        status: to,
        updatedById: members.owner.user.id,
        step: {
          action: to,
          fromStatus: "pending_customer_approval",
          toStatus: to,
          comment: "Signed on the call",
        },
      })
      expect(await statusOf(db, quote.id)).toBe(to)
      const history = await caller("otherMember").quote.approvalHistory({
        id: quote.id,
      })
      expect(history.steps).toMatchObject([
        { action: to, actor: { id: members.owner.user.id } },
      ])
    })
  )

  it("allows the Owner and an Admin; refuses a Manager and another Member", () =>
    withTestDb(async (db) => {
      for (const who of ["manager", "otherMember", "approver"] as const) {
        const { caller, quote } = await setup(db, {
          status: "pending_customer_approval",
        })
        await expect(
          caller(who).quote.recordCustomerOutcome({
            id: quote.id,
            outcome: "approved",
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" })
      }
      const { caller, quote } = await setup(db, {
        status: "pending_customer_approval",
      })
      await expect(
        caller("admin").quote.recordCustomerOutcome({
          id: quote.id,
          outcome: "rejected",
        })
      ).resolves.toMatchObject({ status: "customer_rejected" })
    }))

  it.each([
    "draft",
    "pending_approval",
    "approved",
    "rejected",
    "customer_approved",
    "customer_rejected",
  ] as const)("is refused from %s", (status) =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db, { status })
      await expect(
        caller("owner").quote.recordCustomerOutcome({
          id: quote.id,
          outcome: "approved",
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      expect(await statusOf(db, quote.id)).toBe(status)
    })
  )

  it("makes Customer Approved final", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db, {
        status: "pending_customer_approval",
      })
      await caller("owner").quote.recordCustomerOutcome({
        id: quote.id,
        outcome: "approved",
      })
      const byId = await caller("owner").quote.byId({ id: quote.id })
      expect(byId.locked).toBe(true)
      expect(byId.permissions).toMatchObject({
        canEdit: false,
        canSubmit: false,
        canMarkSent: false,
        canRecordCustomerOutcome: false,
        canRecall: false,
      })
      await expect(
        caller("owner").quote.rename({ id: quote.id, name: "Changed" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      await expect(
        caller("owner").quote.submit({ id: quote.id })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      await expect(
        caller("admin").quote.recordCustomerOutcome({
          id: quote.id,
          outcome: "rejected",
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      expect(await statusOf(db, quote.id)).toBe("customer_approved")
    }))

  it("unlocks a Customer Rejected Quote for editing and resubmission", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db, {
        status: "pending_customer_approval",
      })
      await caller("owner").quote.recordCustomerOutcome({
        id: quote.id,
        outcome: "rejected",
      })
      const byId = await caller("owner").quote.byId({ id: quote.id })
      expect(byId.locked).toBe(false)
      expect(byId.permissions).toMatchObject({ canEdit: true, canSubmit: true })
      await caller("owner").quote.rename({ id: quote.id, name: "Revised" })
      await expect(
        caller("owner").quote.submit({ id: quote.id, comment: "Revised" })
      ).resolves.toMatchObject({ status: "pending_approval" })
      const steps = await stepsOf(db, quote.id)
      expect(steps.map((s) => s.action)).toEqual([
        "customer_rejected",
        "submit",
      ])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db, {
        status: "pending_customer_approval",
      })
      await expectIsolated(db, {
        owner: organization,
        call: (caller) =>
          caller.quote.recordCustomerOutcome({
            id: quote.id,
            outcome: "approved",
          }),
        snapshot: () => statusOf(db, quote.id),
      })
    }))
})

describe("Valid Until", () => {
  it("never changes the Quote Status, even when it has passed", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db, { validUntil: "2020-01-31" })
      const listed = await caller("owner").quote.list({ page: 1, pageSize: 25 })
      expect(listed.rows.find((r) => r.id === quote.id)).toMatchObject({
        status: "approved",
        validUntilPassed: true,
      })
      expect((await caller("owner").quote.byId({ id: quote.id })).status).toBe(
        "approved"
      )
      await caller("owner").quote.markSent({ id: quote.id })
      await caller("owner").quote.recordCustomerOutcome({
        id: quote.id,
        outcome: "approved",
      })
      expect((await caller("owner").quote.byId({ id: quote.id })).status).toBe(
        "customer_approved"
      )
      const draft = await setup(db, {
        status: "draft",
        validUntil: "2020-01-31",
      })
      await draft.caller("owner").quote.rename({
        id: draft.quote.id,
        name: "Still a Draft",
      })
      expect(await statusOf(db, draft.quote.id)).toBe("draft")
    }))
})
