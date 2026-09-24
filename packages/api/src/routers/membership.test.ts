import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"

import {
  createMember,
  createOrganization,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

describe("membership.list", () => {
  it("lists only this Organization's Memberships", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const globex = await createOrganization(db)
      const ada = await createMember(db, acme, {
        role: "admin",
        user: { name: "Ada" },
      })
      const bob = await createMember(db, acme, {
        isApprover: true,
        user: { name: "Bob" },
      })
      await createMember(db, globex, { user: { name: "Gus" } })

      const list = await organizationCaller(db, {
        organization: acme,
        user: bob.user,
      }).membership.list()

      expect(list).toMatchObject([
        {
          id: ada.membership.id,
          role: "admin",
          isApprover: false,
          user: { name: "Ada" },
        },
        {
          id: bob.membership.id,
          role: "member",
          isApprover: true,
          user: { name: "Bob" },
        },
      ])
    }))
})

describe("membership.byId", () => {
  it("returns a Membership of this Organization", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user, membership } = await createMember(db, acme, {
        role: "manager",
      })

      expect(
        await organizationCaller(db, {
          organization: acme,
          user,
        }).membership.byId({ id: membership.id })
      ).toMatchObject({
        id: membership.id,
        role: "manager",
        user: { id: user.id, email: user.email },
      })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { membership } = await createMember(db, acme)

      await expectIsolated(db, {
        owner: acme,
        call: (caller) => caller.membership.byId({ id: membership.id }),
        snapshot: () =>
          db
            .select()
            .from(schema.memberships)
            .where(eq(schema.memberships.id, membership.id)),
      })
    }))
})
