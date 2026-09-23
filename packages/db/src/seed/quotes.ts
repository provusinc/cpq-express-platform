import { and, eq, sql } from "drizzle-orm"

import type { QuoteStatus, TimePeriod } from "@workspace/domain/enums"

import type { Db } from "../index"
import { accounts, quotes, users } from "../schema"
import type { Organization } from "../schema"

/**
 * Demo Quotes for `acme`: header only (no Line Items yet, so every total is
 * zero), spread across owners, Accounts and statuses so the list's filters,
 * the Role rules and the lock can be tried straight away. One has a Valid
 * Until in the past (highlighted in the list).
 *
 * Idempotent: matched by (Organization, owner, Name) and reset to these values.
 */
export const SEED_QUOTES: readonly {
  name: string
  description?: string
  account: string
  owner: string
  status: QuoteStatus
  startDate: string
  endDate: string
  validUntil: string | null
  timePeriod: TimePeriod
}[] = [
  {
    name: "Acme Corp – Platform rollout",
    description: "Phase one: discovery, design and the first two sites.",
    account: "Acme Corp Express CPQ Demo",
    owner: "member@acme.test",
    status: "draft",
    startDate: "2026-10-01",
    endDate: "2027-03-31",
    validUntil: "2026-11-30",
    timePeriod: "months",
  },
  {
    name: "TechStart – Support retainer",
    description: "Twelve months of premium support.",
    account: "TechStart Express CPQ Demo",
    owner: "member@acme.test",
    status: "pending_approval",
    startDate: "2026-11-01",
    endDate: "2027-10-31",
    validUntil: "2026-12-15",
    timePeriod: "quarters",
  },
  {
    name: "Global Mfg – Line automation",
    account: "Global Mfg Express",
    owner: "manager@acme.test",
    status: "approved",
    startDate: "2026-09-01",
    endDate: "2027-02-28",
    validUntil: "2026-10-31",
    timePeriod: "months",
  },
  {
    name: "Healthcare – Records migration",
    description: "Migrate the legacy records system.",
    account: "Healthcare Express",
    owner: "manager@acme.test",
    status: "rejected",
    startDate: "2026-10-05",
    endDate: "2026-12-18",
    validUntil: "2026-09-01",
    timePeriod: "weeks",
  },
  {
    name: "Retail – Store pilot",
    account: "Retail Express",
    owner: "admin@acme.test",
    status: "pending_customer_approval",
    startDate: "2026-10-12",
    endDate: "2026-10-30",
    validUntil: "2026-11-15",
    timePeriod: "days",
  },
  {
    name: "Acme Corp – Analytics add-on",
    account: "Acme Corp Express CPQ Demo",
    owner: "approver@acme.test",
    status: "customer_approved",
    startDate: "2026-07-01",
    endDate: "2026-12-31",
    validUntil: null,
    timePeriod: "months",
  },
  {
    name: "TechStart – Security review",
    account: "TechStart Express CPQ Demo",
    owner: "admin@acme.test",
    status: "customer_rejected",
    startDate: "2026-11-02",
    endDate: "2026-12-11",
    validUntil: "2026-12-01",
    timePeriod: "weeks",
  },
]

export async function seedQuotes(db: Db, organization: Organization) {
  const organizationId = organization.id
  for (const { account: accountName, owner: email, ...values } of SEED_QUOTES) {
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.organizationId, organizationId),
          sql`lower(btrim(${accounts.name})) = lower(btrim(${accountName}))`
        )
      )
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
    if (!account || !owner) {
      throw new Error(`Seed Quote “${values.name}”: missing Account or owner.`)
    }
    const row = {
      ...values,
      description: values.description ?? null,
      accountId: account.id,
      currencyCode: organization.currencyCode,
      updatedById: owner.id,
    }
    const [existing] = await db
      .select({ id: quotes.id })
      .from(quotes)
      .where(
        and(
          eq(quotes.organizationId, organizationId),
          eq(quotes.ownerId, owner.id),
          eq(quotes.name, values.name)
        )
      )
    if (existing) {
      await db.update(quotes).set(row).where(eq(quotes.id, existing.id))
    } else {
      await db.insert(quotes).values({
        ...row,
        organizationId,
        ownerId: owner.id,
        createdById: owner.id,
      })
    }
  }
}
