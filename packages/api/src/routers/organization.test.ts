import { describe, expect, it } from "vitest"

import {
  createMember,
  createMembership,
  createOrganization,
  createTestCaller,
  createUser,
  organizationCaller,
  withTestDb,
} from "../test"

describe("organization.current", () => {
  it("returns the Organization and the caller's Membership", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db, {
        slug: "acme-test",
        name: "Acme",
        currencyCode: "EUR",
      })
      const { user, membership } = await createMember(db, acme, {
        role: "member",
        isApprover: true,
      })

      expect(
        await organizationCaller(db, {
          organization: acme,
          user,
        }).organization.current()
      ).toEqual({
        organization: {
          id: acme.id,
          slug: "acme-test",
          name: "Acme",
          currencyCode: "EUR",
        },
        membership: { id: membership.id, role: "member", isApprover: true },
      })
    }))

  it("refuses a member of another Organization as not found", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const globex = await createOrganization(db)
      const { user } = await createMember(db, globex, { role: "admin" })

      await expect(
        organizationCaller(db, {
          organization: acme,
          user,
        }).organization.current()
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it("refuses an anonymous caller", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      await expect(
        organizationCaller(db, { organization: acme }).organization.current()
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    }))
})

describe("organization.listMine", () => {
  it("lists the caller's Organizations by name, with their Role", () =>
    withTestDb(async (db) => {
      const user = await createUser(db)
      const zeta = await createOrganization(db, { name: "Zeta" })
      const alpha = await createOrganization(db, { name: "Alpha" })
      await createOrganization(db, { name: "Not mine" })
      await createMembership(db, { organization: zeta, user, role: "admin" })
      await createMembership(db, {
        organization: alpha,
        user,
        role: "member",
        isApprover: true,
      })

      expect(
        await createTestCaller(db, { user }).organization.listMine()
      ).toEqual([
        {
          organization: { id: alpha.id, slug: alpha.slug, name: "Alpha" },
          role: "member",
          isApprover: true,
        },
        {
          organization: { id: zeta.id, slug: zeta.slug, name: "Zeta" },
          role: "admin",
          isApprover: false,
        },
      ])
    }))

  it("is empty without Memberships and refuses anonymous callers", () =>
    withTestDb(async (db) => {
      const user = await createUser(db)
      expect(
        await createTestCaller(db, { user }).organization.listMine()
      ).toEqual([])
      await expect(
        createTestCaller(db).organization.listMine()
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    }))
})
