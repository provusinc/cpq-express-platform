import { sql } from "drizzle-orm"

import type { Db } from "../index"
import { memberships, organizations, users } from "../schema"
import type { Role } from "../schema"

/**
 * Identity and tenancy demo data: a Platform Admin, `acme` (USD) with one
 * Membership per Role plus an Approver, and `globex` with a single Admin
 * (the second Organization for trying isolation by hand).
 *
 * Every user signs in by magic link (Mailpit, http://localhost:8025).
 */
export const SEED_PLATFORM_ADMIN = "platform@provus.local"

export const SEED_ORGANIZATIONS = [
  {
    slug: "acme",
    name: "Acme Corporation",
    currencyCode: "USD",
    members: [
      { email: "admin@acme.test", name: "Ada Admin", role: "admin" },
      { email: "manager@acme.test", name: "Max Manager", role: "manager" },
      { email: "member@acme.test", name: "Mia Member", role: "member" },
      {
        email: "approver@acme.test",
        name: "April Approver",
        role: "member",
        isApprover: true,
      },
    ],
  },
  {
    slug: "globex",
    name: "Globex",
    currencyCode: "USD",
    members: [{ email: "admin@globex.test", name: "Gus Admin", role: "admin" }],
  },
] as const satisfies readonly {
  slug: string
  name: string
  currencyCode: string
  members: readonly {
    email: string
    name: string
    role: Role
    isApprover?: boolean
  }[]
}[]

/** Upserts a User by email (keeps their id, so sessions survive a re-seed). */
async function upsertUser(
  db: Db,
  values: { email: string; name: string; isPlatformAdmin?: boolean }
) {
  const [user] = await db
    .insert(users)
    .values({ emailVerified: new Date(), ...values })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: values.name,
        isPlatformAdmin: values.isPlatformAdmin ?? false,
      },
    })
    .returning()
  return user!
}

export async function seedTenancy(db: Db) {
  await upsertUser(db, {
    email: SEED_PLATFORM_ADMIN,
    name: "Pat Platform",
    isPlatformAdmin: true,
  })

  const seeded: Record<string, typeof organizations.$inferSelect> = {}
  for (const { members, ...org } of SEED_ORGANIZATIONS) {
    const [organization] = await db
      .insert(organizations)
      .values(org)
      // The slug is immutable; everything else is reset to the seed values.
      .onConflictDoUpdate({
        target: organizations.slug,
        set: { name: org.name, currencyCode: org.currencyCode },
      })
      .returning()
    seeded[org.slug] = organization!

    for (const member of members) {
      const user = await upsertUser(db, member)
      const isApprover = "isApprover" in member ? member.isApprover : false
      await db
        .insert(memberships)
        .values({
          organizationId: organization!.id,
          userId: user.id,
          role: member.role,
          isApprover,
        })
        .onConflictDoUpdate({
          target: [memberships.organizationId, memberships.userId],
          set: { role: member.role, isApprover, updatedAt: sql`now()` },
        })
    }
  }
  return seeded as Record<
    (typeof SEED_ORGANIZATIONS)[number]["slug"],
    typeof organizations.$inferSelect
  >
}
