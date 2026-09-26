/**
 * Quote Documents (#21): generate (server render, storage, version under the
 * Quote's row lock, snapshots), list, preview input, delete (Owner or Admin,
 * never a captured one) and the download route's authorization
 * (`openQuoteDocument`).
 */
import { afterAll, describe, expect, it } from "vitest"

import { createDb, eq, inArray, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import type { QuoteDocumentSnapshot } from "@workspace/documents"
import { DEFAULT_DOCUMENT_SETTINGS } from "@workspace/domain/documents"
import { createMemoryStorage } from "@workspace/storage"
import { isOrganizationObjectKey } from "@workspace/storage"

import { generateQuoteDocument, QUOTE_DOCUMENT_AREA } from "../documents"
import { ORGANIZATION_SLUG_HEADER } from "../headers"
import {
  createCustomer,
  createContact,
  createMember,
  createOrganization,
  createQuote,
  createResourceRole,
  createSession,
  createUser,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"
import { organizationScope } from "@workspace/db"
import { openQuoteDocument } from "./quote-document"

const { memberships, organizations, phases, quoteDocuments, quotes, users } =
  schema

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const isPdf = (bytes: Uint8Array) =>
  Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-"

/**
 * Acme with a member per Role and one shared store; a Quote owned by the
 * Member for Initech (primary Contact Bill, plus a non-primary one) with a
 * Phase and two Line Items.
 */
async function setup(db: Db) {
  const organization = await createOrganization(db, { name: "Acme" })
  const members = {
    admin: await createMember(db, organization, { role: "admin" }),
    manager: await createMember(db, organization, { role: "manager" }),
    member: await createMember(db, organization, { role: "member" }),
    otherMember: await createMember(db, organization, { role: "member" }),
  }
  const storage = createMemoryStorage()
  const caller = (who: keyof typeof members) =>
    organizationCaller(db, {
      organization,
      user: members[who].user,
      storage,
    })
  const customer = await createCustomer(db, organization, {
    name: "Initech",
    billingStreet: "1 Main St",
    billingCity: "Austin",
  })
  await createContact(db, customer, { name: "Someone Else" })
  await createContact(db, customer, {
    name: "Bill Lumbergh",
    email: "bill@initech.test",
    isPrimary: true,
  })
  const quote = await createQuote(db, organization, {
    owner: members.member.user,
    customer,
    name: "Initech – Oct 2026",
  })
  const role = await createResourceRole(db, organization, {
    name: "Engineer",
    billRate: "150",
    costRate: "100",
  })
  const [phase] = await db
    .insert(phases)
    .values({
      organizationId: organization.id,
      quoteId: quote.id,
      name: "Discovery",
    })
    .returning()
  await caller("member").lineItem.add({
    quoteId: quote.id,
    phaseId: phase!.id,
    items: [{ sourceKind: "resource_role", id: role.id }],
  })
  await caller("member").lineItem.add({
    quoteId: quote.id,
    items: [{ sourceKind: "resource_role", id: role.id }],
  })
  return { organization, members, storage, caller, quote, phase: phase! }
}

describe("quoteDocument.generate", () => {
  it("renders a PDF, stores it and records version 1, 2, 3… per Quote", () =>
    withTestDb(async (db) => {
      const { caller, quote, storage, organization, members } = await setup(db)
      const other = await createQuote(db, organization, {
        owner: members.member.user,
      })

      const first = await caller("member").quoteDocument.generate({
        quoteId: quote.id,
        notes: "  First draft ",
      })
      const second = await caller("manager").quoteDocument.generate({
        quoteId: quote.id,
      })
      const elsewhere = await caller("admin").quoteDocument.generate({
        quoteId: other.id,
      })
      const third = await caller("member").quoteDocument.generate({
        quoteId: quote.id,
      })

      expect([first.version, second.version, third.version]).toEqual([1, 2, 3])
      expect(elsewhere.version).toBe(1)
      expect(first).toMatchObject({
        quoteId: quote.id,
        notes: "First draft",
        capturedByMarkSent: false,
        fileName: "Initech – Oct 2026 v1.pdf",
        downloadUrl: `/api/documents/${first.id}`,
        generatedBy: { id: members.member.user.id },
        canDelete: true,
      })
      expect(second.canDelete).toBe(false) // a Manager, not the Owner

      const [row] = await db
        .select()
        .from(quoteDocuments)
        .where(eq(quoteDocuments.id, first.id))
      expect(
        isOrganizationObjectKey(
          row!.storageKey,
          organization.id,
          QUOTE_DOCUMENT_AREA
        )
      ).toBe(true)
      const object = storage.objects.get(row!.storageKey)!
      expect(object.contentType).toBe("application/pdf")
      expect(isPdf(object.body)).toBe(true)
      expect(row!.fileSize).toBe(object.size)
      expect(first.fileSize).toBe(object.size)
      expect(row!.generatedById).toBe(members.member.user.id)
    }))

  it("keeps the Quote snapshot (Bill To's primary Contact, Phases, lines, no costs) and the settings", () =>
    withTestDb(async (db) => {
      const { caller, quote, phase } = await setup(db)
      await caller("admin").settings.updateDocuments({
        ...DEFAULT_DOCUMENT_SETTINGS,
        format: "compact",
        primaryColor: "#112233",
        terms: "Net 30",
      })
      const document = await caller("member").quoteDocument.generate({
        quoteId: quote.id,
      })
      const [row] = await db
        .select()
        .from(quoteDocuments)
        .where(eq(quoteDocuments.id, document.id))
      const snapshot = row!.quoteSnapshot as QuoteDocumentSnapshot
      const [stored] = await db
        .select()
        .from(quotes)
        .where(eq(quotes.id, quote.id))

      expect(snapshot).toMatchObject({
        schemaVersion: 1,
        version: 1,
        quote: {
          id: quote.id,
          name: "Initech – Oct 2026",
          currencyCode: "USD",
          subtotal: stored!.subtotal,
          total: stored!.total,
        },
        customer: { name: "Initech", billingStreet: "1 Main St" },
        contact: { name: "Bill Lumbergh", email: "bill@initech.test" },
        profile: { name: "Acme" },
        phases: [{ id: phase.id, name: "Discovery" }],
        milestones: [],
        labels: { phase: { singular: "Phase" } },
      })
      expect(snapshot.lines).toHaveLength(2)
      expect(snapshot.lines[0]).toMatchObject({
        phaseId: phase.id,
        name: "Engineer",
        unitPrice: "150.0000",
      })
      expect(JSON.stringify(snapshot)).not.toMatch(/cost|margin/i)
      expect(row!.settingsSnapshot).toMatchObject({
        format: "compact",
        primaryColor: "#112233",
        terms: "Net 30",
      })

      // Later edits don't touch an existing Document's snapshot.
      await caller("member").quote.rename({ id: quote.id, name: "Renamed" })
      const [after] = await db
        .select()
        .from(quoteDocuments)
        .where(eq(quoteDocuments.id, document.id))
      expect((after!.quoteSnapshot as QuoteDocumentSnapshot).quote.name).toBe(
        "Initech – Oct 2026"
      )
    }))

  it("includes the Quote's Milestones by date then name", () =>
    withTestDb(async (db) => {
      const { caller, quote, organization, members } = await setup(db)
      // Another Quote's Milestone stays out of this Quote's Document.
      const otherQuote = await createQuote(db, organization, {
        owner: members.member.user,
      })
      await caller("member").milestone.create({
        quoteId: otherQuote.id,
        name: "Elsewhere",
        date: "2026-10-01",
      })
      for (const input of [
        { name: "Sign-off", date: "2026-12-01", type: "review" as const },
        {
          name: "Deposit",
          date: "2026-10-15",
          type: "payment_due" as const,
          description: "30% up front",
        },
        { name: "Budget", date: "2026-10-15", completed: true },
      ]) {
        await caller("member").milestone.create({ quoteId: quote.id, ...input })
      }

      const document = await caller("member").quoteDocument.generate({
        quoteId: quote.id,
      })
      const [row] = await db
        .select()
        .from(quoteDocuments)
        .where(eq(quoteDocuments.id, document.id))
      const snapshot = row!.quoteSnapshot as QuoteDocumentSnapshot
      expect(snapshot.milestones).toEqual([
        {
          name: "Budget",
          date: "2026-10-15",
          type: "milestone",
          description: null,
          completed: true,
        },
        {
          name: "Deposit",
          date: "2026-10-15",
          type: "payment_due",
          description: "30% up front",
          completed: false,
        },
        {
          name: "Sign-off",
          date: "2026-12-01",
          type: "review",
          description: null,
          completed: false,
        },
      ])

      const preview = await caller("otherMember").quoteDocument.previewSnapshot(
        { quoteId: quote.id }
      )
      expect(preview.snapshot.milestones.map((m) => m.name)).toEqual([
        "Budget",
        "Deposit",
        "Sign-off",
      ])
    }))

  it("is open to every member and allowed on locked Quotes", () =>
    withTestDb(async (db) => {
      const { caller, organization, members } = await setup(db)
      const approved = await createQuote(db, organization, {
        owner: members.otherMember.user,
        stage: "approved",
      })
      for (const who of ["member", "manager", "admin"] as const) {
        await expect(
          caller(who).quoteDocument.generate({ quoteId: approved.id })
        ).resolves.toMatchObject({ quoteId: approved.id })
      }
    }))

  it("embeds a PNG logo", () =>
    withTestDb(async (db) => {
      const { caller, quote, storage } = await setup(db)
      const upload = await caller("admin").settings.requestLogoUpload({
        contentType: "image/png",
        size: PNG.byteLength,
      })
      await storage.put(upload.key, PNG, { contentType: "image/png" })
      await caller("admin").settings.confirmLogoUpload({ key: upload.key })

      const preview = await caller("member").quoteDocument.previewSnapshot({
        quoteId: quote.id,
      })
      expect(preview.logo).toBe(
        `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`
      )
      expect(preview.snapshot.profile.logoKey).toBe(upload.key)
    }))

  it("refuses a malformed or unknown Quote", () =>
    withTestDb(async (db) => {
      const { caller } = await setup(db)
      await expect(
        caller("member").quoteDocument.generate({
          quoteId: "0190f0f0-0000-7000-8000-000000000000",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(
        caller("member").quoteDocument.generate({ quoteId: "nope" })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))

  it("records a Mark as Sent capture (generateQuoteDocument)", () =>
    withTestDb(async (db) => {
      const { quote, organization, members, storage } = await setup(db)
      const document = await generateQuoteDocument(
        organizationScope(db, organization.id),
        quote.id,
        {
          actor: { userId: members.admin.user.id },
          storage,
          capturedByMarkSent: true,
          notes: "Sent to Bill",
        }
      )
      expect(document).toMatchObject({
        version: 1,
        capturedByMarkSent: true,
        notes: "Sent to Bill",
        quoteSnapshot: { quote: { id: quote.id } },
        settingsSnapshot: { format: "standard" },
      })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.quoteDocument.generate({ quoteId: quote.id }),
        snapshot: () =>
          db
            .select()
            .from(quoteDocuments)
            .where(eq(quoteDocuments.quoteId, quote.id)),
      })
    }))
})

describe("quoteDocument.list and previewSnapshot", () => {
  it("lists newest first with who may delete", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      for (let i = 0; i < 3; i++) {
        await caller("manager").quoteDocument.generate({ quoteId: quote.id })
      }
      const asOwner = await caller("member").quoteDocument.list({
        quoteId: quote.id,
      })
      expect(asOwner.map((d) => d.version)).toEqual([3, 2, 1])
      expect(asOwner.every((d) => d.canDelete)).toBe(true)
      const asManager = await caller("manager").quoteDocument.list({
        quoteId: quote.id,
      })
      expect(asManager.every((d) => !d.canDelete)).toBe(true)
      expect(asManager[0]!.generatedBy.email).toMatch(/@/)
    }))

  it("previews the Quote as it is now, with the settings", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const preview = await caller("otherMember").quoteDocument.previewSnapshot(
        { quoteId: quote.id }
      )
      expect(preview.snapshot).toMatchObject({
        version: null,
        contact: { name: "Bill Lumbergh" },
      })
      expect(preview.snapshot.lines).toHaveLength(2)
      expect(preview.settings).toEqual(DEFAULT_DOCUMENT_SETTINGS)
      expect(preview.logo).toBeNull()
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, quote } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.quoteDocument.list({ quoteId: quote.id }),
      })
      await expectIsolated(db, {
        owner: organization,
        call: (caller) =>
          caller.quoteDocument.previewSnapshot({ quoteId: quote.id }),
      })
    }))
})

describe("quoteDocument.delete", () => {
  it("lets the Owner or an Admin delete, removing the file", () =>
    withTestDb(async (db) => {
      const { caller, quote, storage } = await setup(db)
      const a = await caller("manager").quoteDocument.generate({
        quoteId: quote.id,
      })
      const b = await caller("manager").quoteDocument.generate({
        quoteId: quote.id,
      })
      expect(storage.objects.size).toBe(2)

      await caller("member").quoteDocument.delete({ id: a.id })
      await caller("admin").quoteDocument.delete({ id: b.id })

      expect(storage.objects.size).toBe(0)
      expect(
        await caller("member").quoteDocument.list({ quoteId: quote.id })
      ).toEqual([])
      // The next version still counts up from what is left (none): 1.
      const c = await caller("member").quoteDocument.generate({
        quoteId: quote.id,
      })
      expect(c.version).toBe(1)
    }))

  it("refuses anyone else (FORBIDDEN)", () =>
    withTestDb(async (db) => {
      const { caller, quote, storage } = await setup(db)
      const document = await caller("member").quoteDocument.generate({
        quoteId: quote.id,
      })
      for (const who of ["manager", "otherMember"] as const) {
        await expect(
          caller(who).quoteDocument.delete({ id: document.id })
        ).rejects.toMatchObject({ code: "FORBIDDEN" })
      }
      expect(storage.objects.size).toBe(1)
    }))

  it("never deletes a Document captured by Mark as Sent (PRECONDITION_FAILED)", () =>
    withTestDb(async (db) => {
      const { caller, quote, organization, members, storage } = await setup(db)
      const captured = await generateQuoteDocument(
        organizationScope(db, organization.id),
        quote.id,
        {
          actor: { userId: members.member.user.id },
          storage,
          capturedByMarkSent: true,
        }
      )
      for (const who of ["member", "admin"] as const) {
        await expect(
          caller(who).quoteDocument.delete({ id: captured.id })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      }
      const listed = await caller("admin").quoteDocument.list({
        quoteId: quote.id,
      })
      expect(listed).toMatchObject([
        { id: captured.id, capturedByMarkSent: true, canDelete: false },
      ])
      expect(storage.objects.size).toBe(1)
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { caller, organization, quote } = await setup(db)
      const document = await caller("member").quoteDocument.generate({
        quoteId: quote.id,
      })
      await expectIsolated(db, {
        owner: organization,
        call: (outsider) => outsider.quoteDocument.delete({ id: document.id }),
        snapshot: () =>
          db
            .select()
            .from(quoteDocuments)
            .where(eq(quoteDocuments.id, document.id)),
      })
    }))

  it("cascades when the Quote is deleted", () =>
    withTestDb(async (db) => {
      const { caller, quote } = await setup(db)
      const document = await caller("member").quoteDocument.generate({
        quoteId: quote.id,
      })
      await db.delete(quotes).where(eq(quotes.id, quote.id))
      expect(
        await db
          .select()
          .from(quoteDocuments)
          .where(eq(quoteDocuments.id, document.id))
      ).toEqual([])
    }))
})

describe("download (openQuoteDocument)", () => {
  /** The route handler's view of a request: cookie + the proxy's slug header. */
  async function open(
    db: Db,
    storage: ReturnType<typeof createMemoryStorage>,
    id: string,
    { user, slug }: { user?: { id: string }; slug?: string }
  ) {
    const headers = new Headers()
    if (user) headers.set("cookie", (await createSession(db, user)).cookie)
    if (slug) headers.set(ORGANIZATION_SLUG_HEADER, slug)
    return openQuoteDocument({ db, headers, storage }, id)
  }

  it("streams the PDF to any member of the Organization", () =>
    withTestDb(async (db) => {
      const { caller, quote, organization, members, storage } = await setup(db)
      const document = await caller("member").quoteDocument.generate({
        quoteId: quote.id,
      })
      const result = await open(db, storage, document.id, {
        user: members.otherMember.user,
        slug: organization.slug,
      })
      expect(result).toMatchObject({
        ok: true,
        fileName: "Initech – Oct 2026 v1.pdf",
        size: document.fileSize,
      })
      if (result.ok) expect(isPdf(result.body)).toBe(true)
    }))

  it("refuses without a session, without the Host's Organization, and to non-members", () =>
    withTestDb(async (db) => {
      const { caller, quote, organization, storage } = await setup(db)
      const document = await caller("member").quoteDocument.generate({
        quoteId: quote.id,
      })
      const stranger = await createUser(db)
      const outsiderOrg = await createOrganization(db)
      const outsider = await createMember(db, outsiderOrg, { role: "admin" })

      expect(
        await open(db, storage, document.id, { slug: organization.slug })
      ).toMatchObject({ ok: false, status: 401 })
      expect(
        await open(db, storage, document.id, { user: stranger })
      ).toMatchObject({ ok: false, status: 400 })
      expect(
        await open(db, storage, document.id, {
          user: stranger,
          slug: organization.slug,
        })
      ).toMatchObject({ ok: false, status: 404 })
      // Another Organization's member: neither on their subdomain nor on Acme's.
      expect(
        await open(db, storage, document.id, {
          user: outsider.user,
          slug: outsiderOrg.slug,
        })
      ).toMatchObject({ ok: false, status: 404 })
      expect(
        await open(db, storage, document.id, {
          user: outsider.user,
          slug: organization.slug,
        })
      ).toMatchObject({ ok: false, status: 404 })
      expect(
        await open(db, storage, "not-a-uuid", {
          user: outsider.user,
          slug: organization.slug,
        })
      ).toMatchObject({ ok: false, status: 404 })
    }))

  it("answers 404 when the file is gone", () =>
    withTestDb(async (db) => {
      const { caller, quote, organization, members, storage } = await setup(db)
      const document = await caller("member").quoteDocument.generate({
        quoteId: quote.id,
      })
      storage.objects.clear()
      expect(
        await open(db, storage, document.id, {
          user: members.member.user,
          slug: organization.slug,
        })
      ).toMatchObject({ ok: false, status: 404 })
    }))
})

describe("versions under concurrency", () => {
  // Concurrent commands need separate connections, which the rolled-back
  // harness can't give; this test commits to the test database and removes
  // everything it created afterwards.
  const root = createDb(process.env.TEST_DATABASE_URL!, { max: 6 })
  afterAll(() => root.$client.end())

  it("assigns distinct consecutive versions to simultaneous generates", async () => {
    const organization = await createOrganization(root, {
      name: "Concurrency (documents)",
    })
    const { user } = await createMember(root, organization, { role: "member" })
    try {
      const quote = await createQuote(root, organization, { owner: user })
      const storage = createMemoryStorage()
      const caller = organizationCaller(root, { organization, user, storage })
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          caller.quoteDocument.generate({ quoteId: quote.id })
        )
      )
      expect(results.map((d) => d.version).sort()).toEqual([1, 2, 3, 4, 5])
      expect(storage.objects.size).toBe(5)
    } finally {
      await root
        .delete(quoteDocuments)
        .where(eq(quoteDocuments.organizationId, organization.id))
      await root
        .delete(quotes)
        .where(eq(quotes.organizationId, organization.id))
      await root
        .delete(schema.customers)
        .where(eq(schema.customers.organizationId, organization.id))
      await root
        .delete(memberships)
        .where(eq(memberships.organizationId, organization.id))
      await root
        .delete(schema.quoteStatuses)
        .where(eq(schema.quoteStatuses.organizationId, organization.id))
      await root
        .delete(organizations)
        .where(eq(organizations.id, organization.id))
      await root.delete(users).where(inArray(users.id, [user.id]))
    }
  })
})
