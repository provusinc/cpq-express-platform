import { and, eq, sql } from "drizzle-orm"

import type { QuoteStatus, TimePeriod } from "@workspace/domain/enums"

import type { Db } from "../index"
import { customers, quotes, users } from "../schema"
import type { Organization } from "../schema"

/**
 * Demo Quotes for `acme` (their Line Items and Quote Discounts are in
 * `seed/line-items.ts`), spread across owners, Customers, statuses and the
 * last twelve months so the list's filters, the Role rules, the lock and
 * the Dashboard's charts can be tried straight away. One has a Valid Until
 * in the past (highlighted in the list); a few lapse within two weeks of
 * the seed run (`validInDays`), so "Valid Until soon" always has rows.
 *
 * Idempotent: matched by (Organization, owner, Name) and reset to these values
 * (`createdDaysAgo` resets the creation time relative to the run).
 */
const DAY_MS = 86_400_000

export const SEED_QUOTES: readonly {
  name: string
  description?: string
  customer: string
  owner: string
  status: QuoteStatus
  startDate: string
  endDate: string
  validUntil: string | null
  /** Overrides `validUntil`: this many days after the seed run (UTC). */
  validInDays?: number
  /** Created this many days before the seed run. */
  createdDaysAgo?: number
  /**
   * Moves its approval history this many days further back (negative:
   * forward).
   */
  historyDaysAgo?: number
  /** No approval history (its owner is the demo Approver). */
  noHistory?: boolean
  timePeriod: TimePeriod
}[] = [
  {
    name: "Acme Corp – Platform rollout",
    createdDaysAgo: 12,
    description: "Phase one: discovery, design and the first two sites.",
    customer: "Acme Corp Express CPQ Demo",
    owner: "member@acme.test",
    status: "draft",
    startDate: "2026-10-01",
    endDate: "2027-03-31",
    validUntil: "2026-11-30",
    timePeriod: "weeks",
  },
  {
    name: "TechStart – Support retainer",
    createdDaysAgo: 18,
    description: "Twelve months of premium support.",
    customer: "TechStart Express CPQ Demo",
    owner: "member@acme.test",
    status: "pending_approval",
    startDate: "2026-11-01",
    endDate: "2027-10-31",
    validUntil: "2026-12-15",
    timePeriod: "quarters",
  },
  {
    name: "Global Mfg – Line automation",
    createdDaysAgo: 26,
    customer: "Global Mfg Express",
    owner: "manager@acme.test",
    status: "approved",
    startDate: "2026-09-01",
    endDate: "2027-02-28",
    validUntil: "2026-10-31",
    timePeriod: "months",
  },
  {
    name: "Healthcare – Records migration",
    createdDaysAgo: 35,
    description: "Migrate the legacy records system.",
    customer: "Healthcare Express",
    owner: "manager@acme.test",
    status: "rejected",
    startDate: "2026-10-05",
    endDate: "2026-12-18",
    validUntil: "2026-09-01",
    timePeriod: "weeks",
  },
  {
    name: "Retail – Store pilot",
    createdDaysAgo: 14,
    customer: "Retail Express",
    owner: "admin@acme.test",
    status: "pending_customer_approval",
    startDate: "2026-10-12",
    endDate: "2026-10-30",
    validUntil: "2026-11-15",
    timePeriod: "days",
  },
  {
    name: "Acme Corp – Analytics add-on",
    createdDaysAgo: 90,
    noHistory: true,
    customer: "Acme Corp Express CPQ Demo",
    owner: "approver@acme.test",
    status: "customer_approved",
    startDate: "2026-07-01",
    endDate: "2026-12-31",
    validUntil: null,
    timePeriod: "months",
  },
  {
    name: "TechStart – Security review",
    createdDaysAgo: 55,
    customer: "TechStart Express CPQ Demo",
    owner: "admin@acme.test",
    status: "customer_rejected",
    startDate: "2026-11-02",
    endDate: "2026-12-11",
    validUntil: "2026-12-01",
    timePeriod: "weeks",
  },
  // Older and more recent Quotes for the Dashboard's Quote value chart:
  // created across the year, and Customer Approved across the last three
  // months (the Approval Step lands 20 + `historyDaysAgo` days back).
  ...(
    [
      [
        "Global Mfg – Predictive maintenance",
        "Global Mfg Express",
        "manager@acme.test",
        "customer_approved",
        320,
        280,
        null,
      ],
      [
        "Retail – Loyalty app",
        "Retail Express",
        "member@acme.test",
        "customer_approved",
        60,
        -14,
        null,
      ],
      [
        "Healthcare – Patient portal",
        "Healthcare Express",
        "admin@acme.test",
        "customer_rejected",
        250,
        200,
        null,
      ],
      [
        "TechStart – Cloud migration",
        "TechStart Express CPQ Demo",
        "manager@acme.test",
        "customer_approved",
        130,
        55,
        null,
      ],
      [
        "Acme Corp – Data warehouse",
        "Acme Corp Express CPQ Demo",
        "member@acme.test",
        "customer_approved",
        100,
        25,
        null,
      ],
      [
        "Global Mfg – Quality dashboards",
        "Global Mfg Express",
        "admin@acme.test",
        "customer_rejected",
        150,
        110,
        null,
      ],
      [
        "Retail – POS integration",
        "Retail Express",
        "manager@acme.test",
        "approved",
        120,
        0,
        5,
      ],
      [
        "Acme Corp – Integration sprint",
        "Acme Corp Express CPQ Demo",
        "manager@acme.test",
        "rejected",
        100,
        60,
        null,
      ],
      [
        "Healthcare – Compliance audit",
        "Healthcare Express",
        "member@acme.test",
        "pending_approval",
        95,
        0,
        10,
      ],
      [
        "TechStart – Pen test",
        "TechStart Express CPQ Demo",
        "member@acme.test",
        "customer_approved",
        40,
        0,
        null,
      ],
      [
        "TechStart – Mobile MVP",
        "TechStart Express CPQ Demo",
        "member@acme.test",
        "draft",
        5,
        0,
        3,
      ],
      [
        "Acme Corp – Support renewal",
        "Acme Corp Express CPQ Demo",
        "admin@acme.test",
        "pending_customer_approval",
        45,
        0,
        8,
      ],
      [
        "Retail – Analytics add-on",
        "Retail Express",
        "member@acme.test",
        "customer_rejected",
        40,
        5,
        null,
      ],
      [
        "Global Mfg – Line automation phase 2",
        "Global Mfg Express",
        "manager@acme.test",
        "pending_approval",
        30,
        5,
        20,
      ],
      [
        "Retail – Store pilot rollout",
        "Retail Express",
        "admin@acme.test",
        "draft",
        20,
        0,
        40,
      ],
      [
        "Healthcare – Records migration phase 2",
        "Healthcare Express",
        "manager@acme.test",
        "draft",
        3,
        0,
        12,
      ],
    ] as const
  ).map(
    ([
      name,
      customer,
      owner,
      status,
      createdDaysAgo,
      historyDaysAgo,
      validInDays,
    ]) => ({
      name,
      customer,
      owner,
      status,
      startDate: "2026-10-05",
      endDate: "2027-03-26",
      validUntil: null,
      ...(validInDays === null ? {} : { validInDays }),
      createdDaysAgo,
      historyDaysAgo,
      timePeriod: "months" as const,
    })
  ),
]

export async function seedQuotes(db: Db, organization: Organization) {
  const organizationId = organization.id
  const now = Date.now()
  for (const seed of SEED_QUOTES) {
    const {
      customer: customerName,
      owner: email,
      validInDays,
      createdDaysAgo,
    } = seed
    const values = {
      name: seed.name,
      description: seed.description,
      status: seed.status,
      startDate: seed.startDate,
      endDate: seed.endDate,
      validUntil: seed.validUntil,
      timePeriod: seed.timePeriod,
    }
    const [customer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, organizationId),
          sql`lower(btrim(${customers.name})) = lower(btrim(${customerName}))`
        )
      )
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
    if (!customer || !owner) {
      throw new Error(`Seed Quote “${values.name}”: missing Customer or owner.`)
    }
    const row = {
      ...values,
      ...(validInDays === undefined
        ? {}
        : {
            validUntil: new Date(now + validInDays * DAY_MS)
              .toISOString()
              .slice(0, 10),
          }),
      ...(createdDaysAgo === undefined
        ? {}
        : { createdAt: new Date(now - createdDaysAgo * DAY_MS) }),
      description: values.description ?? null,
      customerId: customer.id,
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
