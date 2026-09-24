import { describe, expect, it } from "vitest"

import { schema } from "@workspace/db"
import type { Db } from "@workspace/db"

import {
  createMember,
  createOrganization,
  createUser,
  organizationCaller,
  toSessionUser,
  withTestDb,
} from "./test"
import { ORGANIZATION_SLUG_HEADER } from "./headers"
import {
  adminProcedure,
  createCallerFactory,
  createTRPCContext,
  createTRPCRouter,
  organizationProcedure,
  platformProcedure,
} from "./trpc"

// A router exercising each tier directly, independent of feature routers.
const tiers = createTRPCRouter({
  organization: organizationProcedure.query(({ ctx }) => ({
    organizationId: ctx.organization.id,
    role: ctx.membership.role,
    scopedTo: ctx.scope.organizationId,
  })),
  admin: adminProcedure.query(() => "ok"),
  platform: platformProcedure.query(() => "ok"),
})
const createTiersCaller = createCallerFactory(tiers)

function caller(
  db: Db,
  opts: { user?: typeof schema.users.$inferSelect; slug?: string } = {}
) {
  const headers = new Headers()
  if (opts.slug) headers.set(ORGANIZATION_SLUG_HEADER, opts.slug)
  const session = opts.user
    ? { user: toSessionUser(opts.user), expires: new Date(Date.now() + 60_000) }
    : null
  return createTiersCaller(() => createTRPCContext({ db, headers, session }))
}

describe("organizationProcedure", () => {
  it("requires a session", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      await expect(
        caller(db, { slug: acme.slug }).organization()
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    }))

  it("requires the Organization slug header", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme)
      await expect(caller(db, { user }).organization()).rejects.toMatchObject({
        code: "BAD_REQUEST",
      })
    }))

  it("refuses an unknown Organization and a non-member identically", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const user = await createUser(db)

      const unknown = caller(db, { user, slug: "no-such-org" }).organization()
      const nonMember = caller(db, { user, slug: acme.slug }).organization()

      const [a, b] = await Promise.allSettled([unknown, nonMember])
      expect(a).toMatchObject({
        status: "rejected",
        reason: { code: "NOT_FOUND" },
      })
      expect(b).toMatchObject({
        status: "rejected",
        reason: {
          code: "NOT_FOUND",
          message: (a as PromiseRejectedResult).reason.message,
        },
      })
    }))

  it("exposes the Organization, Membership and a scope bound to it", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme, { role: "manager" })

      expect(
        await caller(db, { user, slug: acme.slug }).organization()
      ).toEqual({
        organizationId: acme.id,
        role: "manager",
        scopedTo: acme.id,
      })
    }))

  it("does not let a Platform Admin in without a Membership", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const user = await createUser(db, { isPlatformAdmin: true })
      await expect(
        caller(db, { user, slug: acme.slug }).organization()
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})

describe("adminProcedure", () => {
  it.each(["manager", "member"] as const)("refuses a %s", (role) =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme, { role, isApprover: true })
      await expect(
        caller(db, { user, slug: acme.slug }).admin()
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    })
  )

  it("allows an Admin", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme, { role: "admin" })
      expect(await caller(db, { user, slug: acme.slug }).admin()).toBe("ok")
    }))

  it("refuses an Admin of another Organization as not found", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const globex = await createOrganization(db)
      const { user } = await createMember(db, globex, { role: "admin" })
      await expect(
        caller(db, { user, slug: acme.slug }).admin()
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})

describe("platformProcedure", () => {
  it("refuses a User who isn't a Platform Admin", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme, { role: "admin" })
      await expect(caller(db, { user }).platform()).rejects.toMatchObject({
        code: "FORBIDDEN",
      })
    }))

  it("allows a Platform Admin on any host", () =>
    withTestDb(async (db) => {
      const user = await createUser(db, { isPlatformAdmin: true })
      expect(await caller(db, { user }).platform()).toBe("ok")
    }))

  it("requires a session", () =>
    withTestDb(async (db) => {
      await expect(caller(db).platform()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      })
    }))
})

describe("organizationCaller", () => {
  it("calls the app router on the given Organization's subdomain", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme)
      const current = await organizationCaller(db, {
        organization: acme,
        user,
      }).organization.current()
      expect(current.organization.id).toBe(acme.id)
    }))
})
