import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"

import {
  createInvitation,
  createMember,
  createMemoryMailer,
  createOrganization,
  createTestCaller,
  createUser,
  organizationCaller,
  tokenFromEmail,
  withTestDb,
} from "../test"

const DAY = 24 * 60 * 60 * 1000

/** An Organization with a pending Invitation for a not-yet-signed-up email. */
async function invited(
  db: Db,
  overrides: Partial<Parameters<typeof createInvitation>[1]> = {}
) {
  const organization = await createOrganization(db, { name: "Acme" })
  const { invitation, token } = await createInvitation(db, {
    organization,
    email: "new.hire@acme.test",
    role: "manager",
    ...overrides,
  })
  return { organization, invitation, token }
}

async function membershipsOf(db: Db, userId: string) {
  return db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, userId))
}

describe("invitation.byToken", () => {
  it("describes a pending Invitation to anyone holding the link", () =>
    withTestDb(async (db) => {
      const { organization, token } = await invited(db)
      expect(
        await createTestCaller(db).invitation.byToken({ token })
      ).toMatchObject({
        status: "pending",
        message: null,
        email: "new.hire@acme.test",
        role: "manager",
        organization: { slug: organization.slug, name: "Acme" },
      })
    }))

  it.each([
    ["expired", { expiresAt: new Date(Date.now() - DAY) }, /expired/],
    ["revoked", { revokedAt: new Date() }, /withdrawn/],
    ["accepted", { acceptedAt: new Date() }, /already been used/],
  ] as const)("explains an %s Invitation", (status, overrides, message) =>
    withTestDb(async (db) => {
      const { token } = await invited(db, overrides)
      expect(
        await createTestCaller(db).invitation.byToken({ token })
      ).toMatchObject({ status, message: expect.stringMatching(message) })
    })
  )

  it("doesn't know an unknown token", () =>
    withTestDb(async (db) => {
      await expect(
        createTestCaller(db).invitation.byToken({ token: "not-a-real-token" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})

describe("invitation.accept", () => {
  it("creates the Membership with the invited Role and uses up the Invitation", () =>
    withTestDb(async (db) => {
      const { organization, invitation, token } = await invited(db)
      const user = await createUser(db, { email: "new.hire@acme.test" })

      const result = await createTestCaller(db, {
        user,
      }).invitation.accept({ token })
      expect(result).toMatchObject({
        organization: { id: organization.id, slug: organization.slug },
        role: "manager",
        alreadyMember: false,
      })

      expect(
        await organizationCaller(db, {
          organization,
          user,
        }).organization.current()
      ).toMatchObject({ membership: { role: "manager", isApprover: false } })

      const [used] = await db
        .select()
        .from(schema.invitations)
        .where(eq(schema.invitations.id, invitation.id))
      expect(used).toMatchObject({ acceptedById: user.id })
      expect(used!.acceptedAt).toBeInstanceOf(Date)
      expect(
        await createTestCaller(db).invitation.byToken({ token })
      ).toMatchObject({ status: "accepted" })
    }))

  it("matches the email case-insensitively", () =>
    withTestDb(async (db) => {
      const { token } = await invited(db)
      const user = await createUser(db, { email: "New.Hire@Acme.test" })
      await expect(
        createTestCaller(db, { user }).invitation.accept({ token })
      ).resolves.toMatchObject({ role: "manager" })
    }))

  it("is single-use", () =>
    withTestDb(async (db) => {
      const { token } = await invited(db)
      const user = await createUser(db, { email: "new.hire@acme.test" })
      const caller = createTestCaller(db, { user })
      await caller.invitation.accept({ token })
      await expect(caller.invitation.accept({ token })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("already been used"),
      })
    }))

  it.each([
    ["expired", { expiresAt: new Date(Date.now() - 1000) }, /expired/],
    ["revoked", { revokedAt: new Date() }, /withdrawn/],
    ["accepted", { acceptedAt: new Date() }, /already been used/],
  ] as const)("refuses an %s Invitation", (_status, overrides, message) =>
    withTestDb(async (db) => {
      const { token } = await invited(db, overrides)
      const user = await createUser(db, { email: "new.hire@acme.test" })
      await expect(
        createTestCaller(db, { user }).invitation.accept({ token })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message })
      expect(await membershipsOf(db, user.id)).toEqual([])
    })
  )

  it("refuses a User signed in with a different email", () =>
    withTestDb(async (db) => {
      const { token } = await invited(db)
      const user = await createUser(db, { email: "someone.else@acme.test" })
      await expect(
        createTestCaller(db, { user }).invitation.accept({ token })
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("new.hire@acme.test"),
      })
      expect(await membershipsOf(db, user.id)).toEqual([])
      expect(
        await createTestCaller(db).invitation.byToken({ token })
      ).toMatchObject({ status: "pending" })
    }))

  it("refuses an anonymous caller", () =>
    withTestDb(async (db) => {
      const { token } = await invited(db)
      await expect(
        createTestCaller(db).invitation.accept({ token })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    }))

  it("refuses an unknown token", () =>
    withTestDb(async (db) => {
      const user = await createUser(db)
      await expect(
        createTestCaller(db, { user }).invitation.accept({ token: "nope" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("keeps an existing Membership as it is", () =>
    withTestDb(async (db) => {
      const { organization, token } = await invited(db, { role: "admin" })
      const { user } = await createMember(db, organization, {
        role: "member",
        user: { email: "new.hire@acme.test" },
      })
      await expect(
        createTestCaller(db, { user }).invitation.accept({ token })
      ).resolves.toMatchObject({ alreadyMember: true })
      expect(await membershipsOf(db, user.id)).toMatchObject([
        { role: "member" },
      ])
    }))

  it("lets a Platform Admin's invitee take over a new Organization", () =>
    withTestDb(async (db) => {
      const platformAdmin = await createUser(db, { isPlatformAdmin: true })
      const mailer = createMemoryMailer()
      const { organization } = await createTestCaller(db, {
        user: platformAdmin,
        mailer,
      }).platform.createOrganization({
        name: "Initech",
        slug: "initech-e2e",
        currencyCode: "USD",
        adminEmail: "bill@initech.test",
      })

      const bill = await createUser(db, { email: "bill@initech.test" })
      await createTestCaller(db, { user: bill }).invitation.accept({
        token: tokenFromEmail(mailer.outbox[0]!),
      })
      expect(
        await organizationCaller(db, {
          organization,
          user: bill,
        }).organization.current()
      ).toMatchObject({
        organization: { slug: "initech-e2e" },
        membership: { role: "admin" },
      })
      // The Platform Admin still has no Membership there.
      await expect(
        organizationCaller(db, {
          organization,
          user: platformAdmin,
        }).organization.current()
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})
