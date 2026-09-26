/**
 * The Quote Stages migration (0016/0017, #29, ADR-0004) against data in the
 * old shape: a scratch database is migrated up to 0015, filled with legacy
 * Quotes (one per old Quote Status), Approval Steps and settings, then
 * migrated to the end, and the result is checked row by row.
 */
import { readFileSync } from "node:fs"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createDb, eq, organizationScope, schema, uuidv7 } from "@workspace/db"
import type { Database } from "@workspace/db"
import { migrationsFolder } from "@workspace/db/migrate"

import { isQuoteRejected } from "../quotes"

/** The last migration in the old (seven Quote Statuses) shape. */
const LEGACY_THROUGH = "0015_rename_accounts_to_customers"

const journal = JSON.parse(
  readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8")
) as { entries: { tag: string }[] }

const statements = (tag: string) =>
  readFileSync(path.join(migrationsFolder, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean)

async function apply(db: Database, tags: string[]) {
  await db.$client.begin(async (tx) => {
    for (const tag of tags) {
      for (const statement of statements(tag)) await tx.unsafe(statement)
    }
  })
}

const legacyEnd = journal.entries.findIndex((e) => e.tag === LEGACY_THROUGH) + 1
const legacyTags = journal.entries.slice(0, legacyEnd).map((e) => e.tag)
const laterTags = journal.entries.slice(legacyEnd).map((e) => e.tag)

const name = `cpq_migration_${uuidv7().replaceAll("-", "").slice(-12)}`
let admin: Database
let db: Database

const ids = {
  user: uuidv7(),
  acme: uuidv7(),
  globex: uuidv7(),
  initech: uuidv7(),
  acmeCustomer: uuidv7(),
  globexCustomer: uuidv7(),
}

/** One legacy Quote per old Quote Status, plus edge cases. */
const LEGACY_QUOTES = {
  draft: { status: "draft", steps: [] },
  pendingApproval: {
    status: "pending_approval",
    steps: [["submit", "draft", "pending_approval"]],
  },
  approved: {
    status: "approved",
    steps: [
      ["submit", "draft", "pending_approval"],
      ["approve", "pending_approval", "approved"],
    ],
  },
  rejected: {
    status: "rejected",
    steps: [
      ["submit", "draft", "pending_approval"],
      ["reject", "pending_approval", "rejected"],
    ],
  },
  // Rejected without the step that says so (older data).
  rejectedWithoutStep: { status: "rejected", steps: [] },
  pendingCustomer: {
    status: "pending_customer_approval",
    steps: [
      ["submit", "draft", "pending_approval"],
      ["approve", "pending_approval", "approved"],
      ["mark_sent", "approved", "pending_customer_approval"],
    ],
  },
  customerApproved: {
    status: "customer_approved",
    steps: [
      ["submit", "draft", "pending_approval"],
      ["approve", "pending_approval", "approved"],
      ["mark_sent", "approved", "pending_customer_approval"],
      ["customer_approved", "pending_customer_approval", "customer_approved"],
    ],
  },
  customerRejected: {
    status: "customer_rejected",
    steps: [
      ["submit", "draft", "pending_approval"],
      ["approve", "pending_approval", "approved"],
      ["mark_sent", "approved", "pending_customer_approval"],
      ["customer_rejected", "pending_customer_approval", "customer_rejected"],
    ],
  },
  // Rejected once, then resubmitted and recalled: a plain Draft now.
  recalledAfterRejection: {
    status: "draft",
    steps: [
      ["submit", "draft", "pending_approval"],
      ["reject", "pending_approval", "rejected"],
      ["submit", "rejected", "pending_approval"],
      ["recall", "pending_approval", "draft"],
    ],
  },
} as const
type LegacyKey = keyof typeof LEGACY_QUOTES
const quoteIds = Object.fromEntries(
  Object.keys(LEGACY_QUOTES).map((key) => [key, uuidv7()])
) as Record<LegacyKey, string>
const globexQuote = uuidv7()

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL!
  admin = createDb(url, { max: 1 })
  await admin.$client.unsafe(`create database "${name}"`)
  const scratch = new URL(url)
  scratch.pathname = `/${name}`
  db = createDb(scratch.toString(), { max: 1 })
  await apply(db, legacyTags)

  const sql = db.$client
  await sql`insert into users (id, email) values (${ids.user}, 'owner@acme.test')`
  await sql`insert into organizations (id, slug, name, currency_code) values
    (${ids.acme}, 'acme', 'Acme', 'USD'),
    (${ids.globex}, 'globex', 'Globex', 'EUR'),
    (${ids.initech}, 'initech', 'Initech', 'USD')`
  // Acme deleted Rejected Quotes only; Globex nothing; Initech never saved.
  await sql`insert into organization_settings (id, organization_id, deletable_statuses) values
    (${uuidv7()}, ${ids.acme}, '{rejected}'),
    (${uuidv7()}, ${ids.globex}, '{}')`
  await sql`insert into customers (id, organization_id, name) values
    (${ids.acmeCustomer}, ${ids.acme}, 'Initech Corp'),
    (${ids.globexCustomer}, ${ids.globex}, 'Hooli')`
  let minute = 0
  for (const [key, legacy] of Object.entries(LEGACY_QUOTES)) {
    const id = quoteIds[key as LegacyKey]
    await sql`insert into quotes (id, organization_id, owner_id, created_by_id, updated_by_id, customer_id, name, start_date, end_date, currency_code, status)
      values (${id}, ${ids.acme}, ${ids.user}, ${ids.user}, ${ids.user}, ${ids.acmeCustomer}, ${key}, '2026-10-01', '2026-12-31', 'USD', ${legacy.status})`
    for (const [action, from, to] of legacy.steps) {
      minute += 1
      await sql`insert into approval_steps (id, organization_id, quote_id, action, from_status, to_status, actor_id, created_at)
        values (${uuidv7()}, ${ids.acme}, ${id}, ${action}, ${from}, ${to}, ${ids.user}, ${new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString()})`
    }
  }
  await sql`insert into quotes (id, organization_id, owner_id, created_by_id, updated_by_id, customer_id, name, start_date, end_date, currency_code, status)
    values (${globexQuote}, ${ids.globex}, ${ids.user}, ${ids.user}, ${ids.user}, ${ids.globexCustomer}, 'Globex', '2026-10-01', '2026-12-31', 'EUR', 'approved')`

  await apply(db, laterTags)
}, 60_000)

afterAll(async () => {
  await db?.$client.end()
  await admin?.$client.unsafe(`drop database if exists "${name}" with (force)`)
  await admin?.$client.end()
})

const { approvalSteps, organizationSettings, quoteStatuses, quotes } = schema

describe("the Quote Stages migration", () => {
  it("gives every Organization the six default Statuses", async () => {
    for (const organizationId of [ids.acme, ids.globex, ids.initech]) {
      const rows = await db
        .select()
        .from(quoteStatuses)
        .where(eq(quoteStatuses.organizationId, organizationId))
      expect(
        Object.fromEntries(rows.map((r) => [r.stage, [r.name, r.sequence]]))
      ).toEqual({
        draft: ["Draft", 0],
        in_approval: ["Pending Approval", 0],
        approved: ["Approved", 0],
        with_customer: ["Sent", 0],
        won: ["Won", 0],
        lost: ["Lost", 0],
      })
      // UUIDv7 ids.
      for (const row of rows) expect(row.id[14]).toBe("7")
    }
  })

  it.each<[LegacyKey, string, boolean]>([
    ["draft", "draft", false],
    ["rejected", "draft", true],
    ["rejectedWithoutStep", "draft", true],
    ["customerRejected", "draft", true],
    ["recalledAfterRejection", "draft", false],
    ["pendingApproval", "in_approval", false],
    ["approved", "approved", false],
    ["pendingCustomer", "with_customer", false],
    ["customerApproved", "won", false],
  ])("maps a %s Quote to %s (Rejected: %s)", async (key, stage, rejected) => {
    const [row] = await db
      .select({
        stage: quotes.stage,
        statusStage: quoteStatuses.stage,
        statusOrganization: quoteStatuses.organizationId,
      })
      .from(quotes)
      .innerJoin(quoteStatuses, eq(quoteStatuses.id, quotes.statusId))
      .where(eq(quotes.id, quoteIds[key]))
    expect(row).toEqual({
      stage,
      statusStage: stage,
      statusOrganization: ids.acme,
    })
    expect(
      await isQuoteRejected(organizationScope(db, ids.acme), quoteIds[key])
    ).toBe(rejected)
  })

  it("lands another Organization's Quote on its own Status", async () => {
    const [row] = await db
      .select({ stage: quotes.stage, statusOrg: quoteStatuses.organizationId })
      .from(quotes)
      .innerJoin(quoteStatuses, eq(quoteStatuses.id, quotes.statusId))
      .where(eq(quotes.id, globexQuote))
    expect(row).toEqual({ stage: "approved", statusOrg: ids.globex })
  })

  it("keeps the approval history, with Stages and the Status names", async () => {
    const steps = async (key: LegacyKey) =>
      (
        await db
          .select()
          .from(approvalSteps)
          .where(eq(approvalSteps.quoteId, quoteIds[key]))
          .orderBy(approvalSteps.createdAt)
      ).map((s) => [
        s.action,
        s.fromStage,
        s.toStage,
        s.fromStatusName,
        s.toStatusName,
      ])
    expect(await steps("customerRejected")).toEqual([
      ["submit", "draft", "in_approval", "Draft", "Pending Approval"],
      ["approve", "in_approval", "approved", "Pending Approval", "Approved"],
      ["mark_sent", "approved", "with_customer", "Approved", "Sent"],
      ["customer_rejected", "with_customer", "draft", "Sent", "Draft"],
    ])
    expect(await steps("customerApproved")).toContainEqual([
      "customer_approved",
      "with_customer",
      "won",
      "Sent",
      "Won",
    ])
    expect(await steps("recalledAfterRejection")).toEqual([
      ["submit", "draft", "in_approval", "Draft", "Pending Approval"],
      ["reject", "in_approval", "draft", "Pending Approval", "Draft"],
      ["submit", "draft", "in_approval", "Draft", "Pending Approval"],
      ["recall", "in_approval", "draft", "Pending Approval", "Draft"],
    ])
    // A rejection without its step gets one, so it stays Rejected.
    expect(await steps("rejectedWithoutStep")).toEqual([
      ["reject", "in_approval", "draft", "Pending Approval", "Draft"],
    ])
    const all = await db.select().from(approvalSteps)
    const legacyCount = Object.values(LEGACY_QUOTES).reduce(
      (n, q) => n + q.steps.length,
      0
    )
    expect(all).toHaveLength(legacyCount + 1)
  })

  it("makes the deletable setting per Stage", async () => {
    const setting = async (organizationId: string) =>
      (
        await db
          .select({ stages: organizationSettings.deletableStages })
          .from(organizationSettings)
          .where(eq(organizationSettings.organizationId, organizationId))
      )[0]?.stages
    expect(await setting(ids.acme)).toEqual(["draft"])
    expect(await setting(ids.globex)).toEqual([])
    expect(await setting(ids.initech)).toBeUndefined()
  })
})
