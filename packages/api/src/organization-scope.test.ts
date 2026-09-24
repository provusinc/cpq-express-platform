import { describe, expect, it } from "vitest"

import { eq, organizationScope, schema } from "@workspace/db"

import {
  createMember,
  createOrganization,
  createUser,
  withTestDb,
} from "./test"

const { memberships } = schema

/** Two Organizations with one Membership each. */
async function twoOrganizations(db: Parameters<typeof organizationScope>[0]) {
  const acme = await createOrganization(db)
  const globex = await createOrganization(db)
  const acmeMember = await createMember(db, acme)
  const globexMember = await createMember(db, globex)
  return { acme, globex, acmeMember, globexMember }
}

describe("organizationScope", () => {
  it("finds only its own Organization's rows", () =>
    withTestDb(async (db) => {
      const { acme, acmeMember, globexMember } = await twoOrganizations(db)
      const scope = organizationScope(db, acme.id)

      expect(
        await scope.findById(memberships, acmeMember.membership.id)
      ).toMatchObject({ id: acmeMember.membership.id })
      expect(
        await scope.findById(memberships, globexMember.membership.id)
      ).toBeUndefined()
      expect((await scope.findMany(memberships)).map((m) => m.id)).toEqual([
        acmeMember.membership.id,
      ])
      expect(
        await scope.findMany(memberships, {
          where: eq(memberships.id, globexMember.membership.id),
        })
      ).toEqual([])
    }))

  it("stamps inserts with its Organization", () =>
    withTestDb(async (db) => {
      const { acme, globex } = await twoOrganizations(db)
      const user = await createUser(db)

      const row = await organizationScope(db, acme.id).insert(memberships, {
        userId: user.id,
        role: "member",
        // A smuggled organizationId is overridden by the scope.
        ...({ organizationId: globex.id } as object),
      })

      expect(row.organizationId).toBe(acme.id)
    }))

  it("updates and deletes only its own rows, and never re-homes a row", () =>
    withTestDb(async (db) => {
      const { acme, globex, acmeMember, globexMember } =
        await twoOrganizations(db)
      const scope = organizationScope(db, acme.id)

      expect(
        await scope.update(memberships, globexMember.membership.id, {
          role: "admin",
        })
      ).toBeUndefined()
      expect(
        await scope.delete(memberships, globexMember.membership.id)
      ).toBeUndefined()
      expect(
        await organizationScope(db, globex.id).findById(
          memberships,
          globexMember.membership.id
        )
      ).toMatchObject({ role: "member" })

      const updated = await scope.update(
        memberships,
        acmeMember.membership.id,
        {
          role: "admin",
          ...({ organizationId: globex.id } as object),
        }
      )
      expect(updated).toMatchObject({ role: "admin", organizationId: acme.id })

      expect(
        await scope.delete(memberships, acmeMember.membership.id)
      ).toMatchObject({ id: acmeMember.membership.id })
      expect(await scope.findMany(memberships)).toEqual([])
    }))

  it("keeps its Organization inside a transaction", () =>
    withTestDb(async (db) => {
      const { acme, acmeMember, globexMember } = await twoOrganizations(db)
      const ids = await organizationScope(db, acme.id).transaction(
        async (tx) => [
          (await tx.findById(memberships, acmeMember.membership.id))?.id,
          (await tx.findById(memberships, globexMember.membership.id))?.id,
        ]
      )
      expect(ids).toEqual([acmeMember.membership.id, undefined])
    }))
})
