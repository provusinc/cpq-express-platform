import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"

import {
  createMembership,
  createOrganization,
  createUser,
  withTestDb,
} from "./index"

/** Runs `fn` in a savepoint so a constraint violation doesn't abort the test. */
async function violation(db: Db, fn: (tx: Db) => Promise<unknown>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx)
    })
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause
    return cause?.message ?? (error as Error).message
  }
  return null
}

describe("organizations table", () => {
  it("rejects reserved, malformed and duplicate slugs", () =>
    withTestDb(async (db) => {
      await createOrganization(db, { slug: "taken" })
      for (const slug of [
        "app",
        "admin",
        "www",
        "Acme",
        "-acme",
        "a.b",
        "taken",
      ]) {
        expect(
          await violation(db, (tx) => createOrganization(tx, { slug })),
          slug
        ).not.toBeNull()
      }
    }))

  it("rejects a malformed currency code", () =>
    withTestDb(async (db) => {
      for (const currencyCode of ["usd", "US", "US1"]) {
        expect(
          await violation(db, (tx) => createOrganization(tx, { currencyCode })),
          currencyCode
        ).not.toBeNull()
      }
    }))

  it("keeps the slug immutable", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db, { slug: "acme-immutable" })
      expect(
        await violation(db, (tx) =>
          tx
            .update(schema.organizations)
            .set({ slug: "renamed" })
            .where(eq(schema.organizations.id, acme.id))
        )
      ).toMatch(/immutable/)
      // Other columns stay editable.
      await db
        .update(schema.organizations)
        .set({ name: "Acme Renamed" })
        .where(eq(schema.organizations.id, acme.id))
    }))
})

describe("memberships table", () => {
  it("allows one Membership per User and Organization", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const user = await createUser(db)
      await createMembership(db, { organization: acme, user })
      expect(
        await violation(db, (tx) =>
          createMembership(tx, { organization: acme, user, role: "admin" })
        )
      ).not.toBeNull()
    }))
})
