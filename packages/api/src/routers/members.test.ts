/**
 * The Members page's commands (#6): Invitations by an Admin, Role and
 * Approver changes, removal and the last-Admin guard. Every procedure here
 * is Admin-only (`members.manage`) and tenancy-isolated.
 */
import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"

import {
  createInvitation,
  createMember,
  createMembership,
  createMemoryMailer,
  createOrganization,
  createTestCaller,
  createUser,
  expectIsolated,
  organizationCaller,
  tokenFromEmail,
  withTestDb,
} from "../test"
import type { TestCaller } from "../test"

const { invitations, memberships, users } = schema
const DAY = 24 * 60 * 60 * 1000

/** Acme with an Admin (the caller) and a Member. */
async function acmeWithAdmin(db: Db) {
  const acme = await createOrganization(db, { name: "Acme" })
  const admin = await createMember(db, acme, {
    role: "admin",
    user: { name: "Ada Admin" },
  })
  const member = await createMember(db, acme, { user: { name: "Mo Member" } })
  const mailer = createMemoryMailer()
  const caller = organizationCaller(db, {
    organization: acme,
    user: admin.user,
    mailer,
  })
  return { acme, admin, member, caller, mailer }
}

const membershipRow = (db: Db, id: string) =>
  db.select().from(memberships).where(eq(memberships.id, id))
const invitationRow = (db: Db, id: string) =>
  db.select().from(invitations).where(eq(invitations.id, id))

describe("members.manage is Admin-only", () => {
  const calls = (
    caller: TestCaller,
    ids: { membershipId: string; invitationId: string }
  ) => ({
    "invitation.list": () => caller.invitation.list(),
    "invitation.create": () =>
      caller.invitation.create({ email: "x@acme.test", role: "member" }),
    "invitation.resend": () =>
      caller.invitation.resend({ id: ids.invitationId }),
    "invitation.revoke": () =>
      caller.invitation.revoke({ id: ids.invitationId }),
    "membership.changeRole": () =>
      caller.membership.changeRole({ id: ids.membershipId, role: "admin" }),
    "membership.setApprover": () =>
      caller.membership.setApprover({ id: ids.membershipId, isApprover: true }),
    "membership.remove": () =>
      caller.membership.remove({ id: ids.membershipId }),
  })

  it.each([
    ["a Manager", "manager", false],
    ["a Member", "member", false],
    ["an Approver who is a Manager", "manager", true],
  ] as const)("refuses %s", (_who, role, isApprover) =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { membership } = await createMember(db, acme)
      const { invitation } = await createInvitation(db, { organization: acme })
      const { user } = await createMember(db, acme, { role, isApprover })
      const caller = organizationCaller(db, { organization: acme, user })

      for (const [name, call] of Object.entries(
        calls(caller, {
          membershipId: membership.id,
          invitationId: invitation.id,
        })
      )) {
        await expect(call(), name).rejects.toMatchObject({ code: "FORBIDDEN" })
      }
      expect(await membershipRow(db, membership.id)).toMatchObject([
        { role: "member", isApprover: false },
      ])
      expect(await invitationRow(db, invitation.id)).toMatchObject([
        { revokedAt: null, tokenHash: invitation.tokenHash },
      ])
    })
  )

  it("refuses a non-member on the Organization's subdomain", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const outsider = await createUser(db)
      const caller = organizationCaller(db, {
        organization: acme,
        user: outsider,
      })
      await expect(caller.invitation.list()).rejects.toMatchObject({
        code: "NOT_FOUND",
      })
      await expect(
        caller.invitation.create({ email: "x@acme.test", role: "admin" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})

describe("invitation.create", () => {
  it("invites someone with a Role and emails them the link", () =>
    withTestDb(async (db) => {
      const { acme, caller, mailer } = await acmeWithAdmin(db)
      const invitation = await caller.invitation.create({
        email: " New@Acme.test ",
        role: "manager",
      })
      expect(invitation).toMatchObject({
        email: "new@acme.test",
        role: "manager",
      })
      expect(mailer.outbox).toMatchObject([
        { to: "new@acme.test", subject: expect.stringContaining("Acme") },
      ])
      expect(mailer.outbox[0]!.text).toContain("Ada Admin")
      expect(mailer.outbox[0]!.text).toContain("as a Manager")

      const invitee = await createUser(db, { email: "new@acme.test" })
      await createTestCaller(db, { user: invitee }).invitation.accept({
        token: tokenFromEmail(mailer.outbox[0]!),
      })
      expect(
        await organizationCaller(db, {
          organization: acme,
          user: invitee,
        }).organization.current()
      ).toMatchObject({ membership: { role: "manager" } })
    }))

  it("refuses someone who is already a member", () =>
    withTestDb(async (db) => {
      const { member, caller, mailer } = await acmeWithAdmin(db)
      await expect(
        caller.invitation.create({ email: member.user.email, role: "admin" })
      ).rejects.toMatchObject({ code: "CONFLICT" })
      expect(mailer.outbox).toEqual([])
    }))

  it("replaces an earlier open Invitation for the same email", () =>
    withTestDb(async (db) => {
      const { caller, mailer } = await acmeWithAdmin(db)
      await caller.invitation.create({
        email: "twice@acme.test",
        role: "member",
      })
      await caller.invitation.create({
        email: "twice@acme.test",
        role: "admin",
      })
      const [first, second] = mailer.outbox.map(tokenFromEmail)
      const anon = createTestCaller(db)
      expect(await anon.invitation.byToken({ token: first! })).toMatchObject({
        status: "revoked",
      })
      expect(await anon.invitation.byToken({ token: second! })).toMatchObject({
        status: "pending",
        role: "admin",
      })
      expect(await caller.invitation.list()).toMatchObject([
        { email: "twice@acme.test", role: "admin" },
      ])
    }))

  it("rejects an invalid email or Role", () =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      await expect(
        caller.invitation.create({ email: "not-an-email", role: "member" })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      await expect(
        caller.invitation.create({
          email: "x@acme.test",
          role: "owner" as "admin",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))
})

describe("invitation.list", () => {
  it("lists open Invitations only, with their status and inviter", () =>
    withTestDb(async (db) => {
      const { acme, admin, caller } = await acmeWithAdmin(db)
      await createInvitation(db, {
        organization: acme,
        email: "pending@acme.test",
        role: "manager",
        invitedById: admin.user.id,
      })
      await createInvitation(db, {
        organization: acme,
        email: "expired@acme.test",
        expiresAt: new Date(Date.now() - DAY),
      })
      await createInvitation(db, {
        organization: acme,
        email: "used@acme.test",
        acceptedAt: new Date(),
      })
      await createInvitation(db, {
        organization: acme,
        email: "revoked@acme.test",
        revokedAt: new Date(),
      })
      const globex = await createOrganization(db)
      await createInvitation(db, {
        organization: globex,
        email: "other@globex.test",
      })

      expect(await caller.invitation.list()).toMatchObject([
        { email: "expired@acme.test", status: "expired" },
        {
          email: "pending@acme.test",
          role: "manager",
          status: "pending",
          invitedBy: { name: "Ada Admin" },
        },
      ])
    }))
})

describe("invitation.resend", () => {
  it("emails a new link, retires the old one and extends the expiry", () =>
    withTestDb(async (db) => {
      const { acme, caller, mailer } = await acmeWithAdmin(db)
      const { invitation, token } = await createInvitation(db, {
        organization: acme,
        email: "late@acme.test",
        expiresAt: new Date(Date.now() - DAY),
      })

      const resent = await caller.invitation.resend({ id: invitation.id })
      expect(resent.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * DAY)
      expect(mailer.outbox).toMatchObject([{ to: "late@acme.test" }])

      const anon = createTestCaller(db)
      await expect(anon.invitation.byToken({ token })).rejects.toMatchObject({
        code: "NOT_FOUND",
      })
      expect(
        await anon.invitation.byToken({
          token: tokenFromEmail(mailer.outbox[0]!),
        })
      ).toMatchObject({ status: "pending" })
    }))

  it("refuses a revoked or accepted Invitation", () =>
    withTestDb(async (db) => {
      const { acme, caller, mailer } = await acmeWithAdmin(db)
      for (const closed of [
        { revokedAt: new Date() },
        { acceptedAt: new Date() },
      ]) {
        const { invitation } = await createInvitation(db, {
          organization: acme,
          ...closed,
        })
        await expect(
          caller.invitation.resend({ id: invitation.id })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      }
      expect(mailer.outbox).toEqual([])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { invitation } = await createInvitation(db, { organization: acme })
      await expectIsolated(db, {
        owner: acme,
        call: (caller) => caller.invitation.resend({ id: invitation.id }),
        snapshot: () => invitationRow(db, invitation.id),
      })
    }))
})

describe("invitation.revoke", () => {
  it("withdraws an Invitation so its link stops working", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await acmeWithAdmin(db)
      const { invitation, token } = await createInvitation(db, {
        organization: acme,
      })
      await caller.invitation.revoke({ id: invitation.id })
      // Idempotent.
      await caller.invitation.revoke({ id: invitation.id })

      expect(await caller.invitation.list()).toEqual([])
      const invitee = await createUser(db, { email: invitation.email })
      await expect(
        createTestCaller(db, { user: invitee }).invitation.accept({ token })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    }))

  it("refuses an accepted Invitation", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await acmeWithAdmin(db)
      const { invitation } = await createInvitation(db, {
        organization: acme,
        acceptedAt: new Date(),
      })
      await expect(
        caller.invitation.revoke({ id: invitation.id })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { invitation } = await createInvitation(db, { organization: acme })
      await expectIsolated(db, {
        owner: acme,
        call: (caller) => caller.invitation.revoke({ id: invitation.id }),
        snapshot: () => invitationRow(db, invitation.id),
      })
    }))
})

describe("membership.changeRole", () => {
  it("gives a member another Role", () =>
    withTestDb(async (db) => {
      const { member, caller } = await acmeWithAdmin(db)
      expect(
        await caller.membership.changeRole({
          id: member.membership.id,
          role: "manager",
        })
      ).toEqual({ id: member.membership.id, role: "manager" })
      expect(await membershipRow(db, member.membership.id)).toMatchObject([
        { role: "manager" },
      ])
    }))

  it("keeps the Approver right when the Role changes", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await acmeWithAdmin(db)
      const approver = await createMember(db, acme, { isApprover: true })
      await caller.membership.changeRole({
        id: approver.membership.id,
        role: "admin",
      })
      expect(await membershipRow(db, approver.membership.id)).toMatchObject([
        { role: "admin", isApprover: true },
      ])
    }))

  it("won't demote the last Admin, even themselves", () =>
    withTestDb(async (db) => {
      const { admin, caller } = await acmeWithAdmin(db)
      await expect(
        caller.membership.changeRole({
          id: admin.membership.id,
          role: "member",
        })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("last Admin"),
      })
      expect(await membershipRow(db, admin.membership.id)).toMatchObject([
        { role: "admin" },
      ])
      // Re-affirming the Role is fine.
      await caller.membership.changeRole({
        id: admin.membership.id,
        role: "admin",
      })
    }))

  it("lets an Admin step down once there is another Admin", () =>
    withTestDb(async (db) => {
      const { admin, member, caller } = await acmeWithAdmin(db)
      await caller.membership.changeRole({
        id: member.membership.id,
        role: "admin",
      })
      await caller.membership.changeRole({
        id: admin.membership.id,
        role: "manager",
      })
      // Now a Manager: no longer allowed to manage members.
      await expect(
        caller.membership.changeRole({
          id: member.membership.id,
          role: "member",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { membership } = await createMember(db, acme, { role: "admin" })
      await createMember(db, acme, { role: "admin" })
      await expectIsolated(db, {
        owner: acme,
        call: (caller) =>
          caller.membership.changeRole({ id: membership.id, role: "member" }),
        snapshot: () => membershipRow(db, membership.id),
      })
    }))
})

describe("membership.setApprover", () => {
  it("grants and removes the Approver right independently of Role", () =>
    withTestDb(async (db) => {
      const { admin, member, caller } = await acmeWithAdmin(db)
      await caller.membership.setApprover({
        id: member.membership.id,
        isApprover: true,
      })
      await caller.membership.setApprover({
        id: admin.membership.id,
        isApprover: true,
      })
      expect(await membershipRow(db, member.membership.id)).toMatchObject([
        { role: "member", isApprover: true },
      ])
      await caller.membership.setApprover({
        id: member.membership.id,
        isApprover: false,
      })
      expect(await membershipRow(db, member.membership.id)).toMatchObject([
        { role: "member", isApprover: false },
      ])
      expect(await membershipRow(db, admin.membership.id)).toMatchObject([
        { role: "admin", isApprover: true },
      ])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { membership } = await createMember(db, acme)
      await expectIsolated(db, {
        owner: acme,
        call: (caller) =>
          caller.membership.setApprover({
            id: membership.id,
            isApprover: true,
          }),
        snapshot: () => membershipRow(db, membership.id),
      })
    }))
})

describe("membership.remove", () => {
  it("deletes the Membership but keeps the User and their other Memberships", () =>
    withTestDb(async (db) => {
      const { acme, member, caller } = await acmeWithAdmin(db)
      // The same person also belongs to another Organization.
      const globex = await createOrganization(db)
      const elsewhere = await createMembership(db, {
        organization: globex,
        user: member.user,
      })

      await caller.membership.remove({ id: member.membership.id })

      expect(await membershipRow(db, member.membership.id)).toEqual([])
      expect(
        await db.select().from(users).where(eq(users.id, member.user.id))
      ).toHaveLength(1)
      expect(await membershipRow(db, elsewhere.id)).toHaveLength(1)
      await expect(
        organizationCaller(db, {
          organization: acme,
          user: member.user,
        }).organization.current()
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("won't remove the last Admin, even themselves", () =>
    withTestDb(async (db) => {
      const { admin, caller } = await acmeWithAdmin(db)
      await expect(
        caller.membership.remove({ id: admin.membership.id })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("last Admin"),
      })
      expect(await membershipRow(db, admin.membership.id)).toHaveLength(1)
    }))

  it("removes an Admin when another Admin remains", () =>
    withTestDb(async (db) => {
      const { acme, admin, caller } = await acmeWithAdmin(db)
      const other = await createMember(db, acme, { role: "admin" })
      await caller.membership.remove({ id: other.membership.id })
      // And an Admin may leave while another Admin remains.
      const third = await createMember(db, acme, { role: "admin" })
      await caller.membership.remove({ id: admin.membership.id })
      expect(await membershipRow(db, third.membership.id)).toHaveLength(1)
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { membership } = await createMember(db, acme)
      await expectIsolated(db, {
        owner: acme,
        call: (caller) => caller.membership.remove({ id: membership.id }),
        snapshot: () => membershipRow(db, membership.id),
      })
    }))
})
