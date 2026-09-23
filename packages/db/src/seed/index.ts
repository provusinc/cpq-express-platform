/**
 * `pnpm db:seed` — demo data for local development, into DATABASE_URL.
 *
 * Idempotent: every step upserts by a natural key (User email, Organization
 * slug, Membership (Organization, User)), so it can run any number of times
 * and resets seeded rows to their seed values without touching anything
 * else. For a clean slate, drop the database volume (`docker compose down -v`)
 * and run `pnpm services:up && pnpm db:migrate && pnpm db:seed`.
 *
 * Areas: tenancy (Users, Organizations, Memberships), then `acme`'s demo
 * Accounts with Contacts. Add later areas as further `seed<Area>(tx, …)`
 * steps below, each idempotent the same way.
 */
import { fileURLToPath } from "node:url"

import { createDb } from "../index"
import type { Db } from "../index"
import { SEED_INVITATION, seedInvitations } from "./invitations"
import { seedAccounts } from "./accounts"
import { seedTenancy } from "./tenancy"

export { SEED_ACCOUNTS, seedAccounts } from "./accounts"
export { SEED_ORGANIZATIONS, SEED_PLATFORM_ADMIN, seedTenancy } from "./tenancy"
export { SEED_INVITATION, seedInvitations } from "./invitations"

export async function seed(db: Db) {
  return db.transaction(async (tx) => {
    const organizations = await seedTenancy(tx)
    await seedInvitations(tx, organizations)
    await seedAccounts(tx, organizations.acme)
    return { organizations }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("DATABASE_URL is not set (copy .env.example to .env).")
    process.exit(1)
  }
  const db = createDb(url, { max: 1 })
  try {
    const { organizations } = await seed(db)
    console.log(
      `Seeded ${new URL(url).pathname.slice(1)}: Organizations ${Object.keys(organizations).join(", ")}; ` +
        `a pending Invitation for ${SEED_INVITATION.email} at /invitations/${SEED_INVITATION.token} on the app host.`
    )
  } finally {
    await db.$client.end()
  }
}
