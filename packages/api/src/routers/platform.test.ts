import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import { QUOTE_STAGES } from "@workspace/domain/enums"
import type { QuoteStage } from "@workspace/domain/enums"
import { DEFAULT_CUSTOMER_CLASSIFICATIONS } from "@workspace/domain/customers"
import { RESERVED_SLUGS } from "@workspace/domain/organizations"

import {
  createInvitation,
  createMember,
  createMemoryMailer,
  createOrganization,
  createTestCaller,
  createUser,
  tokenFromEmail,
  withTestDb,
} from "../test"
import type { TestCaller } from "../test"
import type { Db } from "@workspace/db"

async function platformCaller(db: Db, mailer = createMemoryMailer()) {
  const user = await createUser(db, {
    name: "Pat Platform",
    isPlatformAdmin: true,
  })
  return { caller: createTestCaller(db, { user, mailer }), user, mailer }
}

/** Every platform procedure, called with harmless input. */
const everyProcedure = (caller: TestCaller) => [
  () => caller.platform.listOrganizations(),
  () =>
    caller.platform.createOrganization({
      name: "Nope",
      slug: "nope-org",
      currencyCode: "USD",
    }),
  () =>
    caller.platform.inviteAdmin({
      organizationId: "01900000-0000-7000-8000-000000000000",
      email: "someone@example.test",
    }),
]

describe("platform tier", () => {
  it("refuses anonymous callers", () =>
    withTestDb(async (db) => {
      for (const call of everyProcedure(createTestCaller(db))) {
        await expect(call()).rejects.toMatchObject({ code: "UNAUTHORIZED" })
      }
    }))

  it("refuses signed-in Users who aren't Platform Admins, even Admins", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme, {
        role: "admin",
        isApprover: true,
      })
      for (const call of everyProcedure(createTestCaller(db, { user }))) {
        await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" })
      }
    }))
})

describe("platform.createOrganization", () => {
  it("provisions an Organization", () =>
    withTestDb(async (db) => {
      const { caller, mailer } = await platformCaller(db)
      const { organization, invitation } =
        await caller.platform.createOrganization({
          name: "  Initech ",
          slug: "initech",
          currencyCode: "eur",
        })
      expect(organization).toMatchObject({
        name: "Initech",
        slug: "initech",
        currencyCode: "EUR",
      })
      expect(invitation).toBeNull()
      expect(mailer.outbox).toEqual([])
    }))

  it("gives the new Organization the default Quote Statuses, one per Stage", () =>
    withTestDb(async (db) => {
      const { caller } = await platformCaller(db)
      const { organization } = await caller.platform.createOrganization({
        name: "Initech",
        slug: "initech",
        currencyCode: "USD",
      })
      const statuses = await db
        .select()
        .from(schema.quoteStatuses)
        .where(eq(schema.quoteStatuses.organizationId, organization.id))
      expect(
        statuses
          .map((s) => [s.stage, s.name, s.sequence, s.colour])
          .sort(
            (a, b) =>
              QUOTE_STAGES.indexOf(a[0] as QuoteStage) -
              QUOTE_STAGES.indexOf(b[0] as QuoteStage)
          )
      ).toEqual([
        ["draft", "Draft", 0, null],
        ["in_approval", "Pending Approval", 0, null],
        ["approved", "Approved", 0, null],
        ["with_customer", "Sent", 0, null],
        ["won", "Won", 0, null],
        ["lost", "Lost", 0, null],
      ])
    }))

  it("gives the new Organization the default Customer Types and Industries", () =>
    withTestDb(async (db) => {
      const { caller } = await platformCaller(db)
      const { organization } = await caller.platform.createOrganization({
        name: "Initech",
        slug: "initech",
        currencyCode: "USD",
      })
      const values = await db
        .select()
        .from(schema.customerClassifications)
        .where(
          eq(schema.customerClassifications.organizationId, organization.id)
        )
        .orderBy(
          schema.customerClassifications.kind,
          schema.customerClassifications.sequence
        )
      const names = (kind: string) =>
        values.filter((v) => v.kind === kind).map((v) => v.name)
      expect(names("customer_type")).toEqual([
        ...DEFAULT_CUSTOMER_CLASSIFICATIONS.customer_type,
      ])
      expect(names("industry")).toEqual([
        ...DEFAULT_CUSTOMER_CLASSIFICATIONS.industry,
      ])
      expect(values.every((v) => v.retiredAt === null)).toBe(true)
    }))

  it.each([...RESERVED_SLUGS])("rejects the reserved slug %s", (slug) =>
    withTestDb(async (db) => {
      const { caller } = await platformCaller(db)
      await expect(
        caller.platform.createOrganization({
          name: "Platform",
          slug,
          currencyCode: "USD",
        })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("reserved"),
      })
    })
  )

  it.each(["Acme", "-acme", "acme-", "ac_me", "a.b", "", "a".repeat(64)])(
    "rejects the malformed slug %j",
    (slug) =>
      withTestDb(async (db) => {
        const { caller } = await platformCaller(db)
        await expect(
          caller.platform.createOrganization({
            name: "Acme",
            slug,
            currencyCode: "USD",
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      })
  )

  it("rejects a slug that is already taken", () =>
    withTestDb(async (db) => {
      await createOrganization(db, { slug: "taken-slug" })
      const { caller } = await platformCaller(db)
      await expect(
        caller.platform.createOrganization({
          name: "Second",
          slug: "taken-slug",
          currencyCode: "USD",
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("already taken"),
      })
    }))

  it("rejects an unknown currency", () =>
    withTestDb(async (db) => {
      const { caller } = await platformCaller(db)
      for (const currencyCode of ["US", "XYZ", "dollars"]) {
        await expect(
          caller.platform.createOrganization({
            name: "Acme",
            slug: "acme-currency",
            currencyCode,
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
    }))

  it("invites the first Admin when an email is given", () =>
    withTestDb(async (db) => {
      const { caller, mailer } = await platformCaller(db)
      const { organization, invitation } =
        await caller.platform.createOrganization({
          name: "Hooli",
          slug: "hooli",
          currencyCode: "USD",
          adminEmail: "Gavin@Hooli.test",
        })
      expect(invitation).toMatchObject({
        email: "gavin@hooli.test",
        role: "admin",
      })
      expect(mailer.outbox).toHaveLength(1)
      const [message] = mailer.outbox
      expect(message).toMatchObject({
        to: "gavin@hooli.test",
        subject: expect.stringContaining("Hooli"),
      })
      expect(message!.text).toContain("Pat Platform")
      expect(message!.text).toContain("as an Admin")
      expect(message!.text).toContain(
        "http://app.localtest.me:3000/invitations/"
      )

      const preview = await createTestCaller(db).invitation.byToken({
        token: tokenFromEmail(message!),
      })
      expect(preview).toMatchObject({
        status: "pending",
        role: "admin",
        email: "gavin@hooli.test",
        organization: { slug: organization.slug, name: "Hooli" },
      })
    }))

  it("keeps nothing when the Invitation email can't be sent", () =>
    withTestDb(async (db) => {
      const { caller } = await platformCaller(db, {
        outbox: [],
        send: () => Promise.reject(new Error("SMTP down")),
      })
      await expect(
        caller.platform.createOrganization({
          name: "Pied Piper",
          slug: "pied-piper",
          currencyCode: "USD",
          adminEmail: "richard@piedpiper.test",
        })
      ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" })
      const list = await caller.platform.listOrganizations()
      expect(list.map((o) => o.slug)).not.toContain("pied-piper")
    }))
})

describe("platform.listOrganizations", () => {
  it("lists every Organization with its member count and creation date", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db, { name: "Acme" })
      await createMember(db, acme, { role: "admin" })
      await createMember(db, acme)
      const empty = await createOrganization(db, { name: "Empty" })
      await createInvitation(db, {
        organization: empty,
        email: "first@empty.test",
        role: "admin",
      })

      const { caller } = await platformCaller(db)
      const list = await caller.platform.listOrganizations()
      const byId = new Map(list.map((o) => [o.id, o]))
      expect(byId.get(acme.id)).toMatchObject({
        name: "Acme",
        slug: acme.slug,
        memberCount: 2,
        createdAt: acme.createdAt,
        invitations: [],
      })
      expect(byId.get(empty.id)).toMatchObject({
        memberCount: 0,
        invitations: [
          { email: "first@empty.test", role: "admin", status: "pending" },
        ],
      })
    }))
})

describe("platform.inviteAdmin", () => {
  it("emails an Admin Invitation that replaces any earlier one", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db, { name: "Acme" })
      const { caller, mailer } = await platformCaller(db)
      const anon = createTestCaller(db)

      await caller.platform.inviteAdmin({
        organizationId: acme.id,
        email: "boss@acme.test",
      })
      await caller.platform.inviteAdmin({
        organizationId: acme.id,
        email: "boss@acme.test",
      })
      const [first, second] = mailer.outbox.map(tokenFromEmail)

      expect(await anon.invitation.byToken({ token: first! })).toMatchObject({
        status: "revoked",
      })
      expect(await anon.invitation.byToken({ token: second! })).toMatchObject({
        status: "pending",
        role: "admin",
      })
    }))

  it("refuses an unknown Organization", () =>
    withTestDb(async (db) => {
      const { caller } = await platformCaller(db)
      await expect(() =>
        caller.platform.inviteAdmin({
          organizationId: "01900000-0000-7000-8000-000000000000",
          email: "boss@acme.test",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("refuses someone who is already a member", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme, {
        user: { email: "already@acme.test" },
      })
      const { caller, mailer } = await platformCaller(db)
      await expect(() =>
        caller.platform.inviteAdmin({
          organizationId: acme.id,
          email: user.email.toUpperCase(),
        })
      ).rejects.toMatchObject({ code: "CONFLICT" })
      expect(mailer.outbox).toEqual([])
    }))
})
