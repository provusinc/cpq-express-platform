/**
 * The Customer Type / Industry migration (0020/0021, #31) against data in the
 * old shape: a scratch database is migrated up to 0019, filled with Customers
 * whose Type and Industry are free text, then migrated to the end, and the
 * value lists and references are checked.
 */
import { readFileSync } from "node:fs"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { and, asc, createDb, eq, schema, uuidv7 } from "@workspace/db"
import type { Database } from "@workspace/db"
import { migrationsFolder } from "@workspace/db/migrate"
import { DEFAULT_CUSTOMER_CLASSIFICATIONS } from "@workspace/domain/customers"

/** The last migration with free-text Customer Type and Industry. */
const LEGACY_THROUGH = "0019_status_change_action"

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

const ids = { acme: uuidv7(), globex: uuidv7(), initech: uuidv7() }

/** Acme's Customers: [name, type, industry]. */
const ACME_CUSTOMERS = [
  ["A", "Prospect", "Software"],
  ["B", " prospect ", "software"],
  ["C", "Prospect", "Retail"],
  ["D", "Customer - Direct", null],
  ["E", "CUSTOMER - DIRECT", "  "],
  ["F", "customer - direct", "Retail"],
  ["G", "Customer - Direct", "retail"],
  ["H", null, null],
  ["I", null, "Software"],
] as const
const customerIds = Object.fromEntries(
  ACME_CUSTOMERS.map(([key]) => [key, uuidv7()])
) as Record<(typeof ACME_CUSTOMERS)[number][0], string>
const globexCustomer = uuidv7()

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL!
  admin = createDb(url, { max: 1 })
  await admin.$client.unsafe(`create database "${name}"`)
  const scratch = new URL(url)
  scratch.pathname = `/${name}`
  db = createDb(scratch.toString(), { max: 1 })
  await apply(db, legacyTags)

  const sql = db.$client
  // Acme has free text; Globex only an Industry; Initech no Customers.
  await sql`insert into organizations (id, slug, name, currency_code) values
    (${ids.acme}, 'acme', 'Acme', 'USD'),
    (${ids.globex}, 'globex', 'Globex', 'EUR'),
    (${ids.initech}, 'initech', 'Initech', 'USD')`
  for (const [key, type, industry] of ACME_CUSTOMERS) {
    await sql`insert into customers (id, organization_id, name, type, industry)
      values (${customerIds[key]}, ${ids.acme}, ${key}, ${type}, ${industry})`
  }
  await sql`insert into customers (id, organization_id, name, type, industry)
    values (${globexCustomer}, ${ids.globex}, 'Hooli', null, 'Retail')`

  await apply(db, laterTags)
}, 60_000)

afterAll(async () => {
  await db?.$client.end()
  await admin?.$client.unsafe(`drop database if exists "${name}" with (force)`)
  await admin?.$client.end()
})

const { customerClassifications: values, customers } = schema

const valuesOf = (organizationId: string, kind: "customer_type" | "industry") =>
  db
    .select()
    .from(values)
    .where(
      and(eq(values.organizationId, organizationId), eq(values.kind, kind))
    )
    .orderBy(asc(values.sequence))

/** Each Customer's value names: key → [type, industry]. */
async function assigned(organizationId: string) {
  const rows = await db
    .select()
    .from(customers)
    .where(eq(customers.organizationId, organizationId))
  const all = await db
    .select()
    .from(values)
    .where(eq(values.organizationId, organizationId))
  const nameOf = (id: string | null) =>
    id ? all.find((v) => v.id === id)!.name : null
  return Object.fromEntries(
    rows.map((r) => [r.name, [nameOf(r.customerTypeId), nameOf(r.industryId)]])
  )
}

describe("the Customer Type / Industry migration", () => {
  it("creates one value per distinct text, trimmed and ignoring case, the most common spelling winning", async () => {
    const types = await valuesOf(ids.acme, "customer_type")
    expect(types.map((v) => [v.name, v.sequence, v.retiredAt])).toEqual([
      ["Customer - Direct", 0, null],
      ["Prospect", 1, null],
    ])
    expect((await valuesOf(ids.acme, "industry")).map((v) => v.name)).toEqual([
      "Retail",
      "Software",
    ])
    // UUIDv7 ids.
    for (const value of types) expect(value.id[14]).toBe("7")
  })

  it("points every Customer at the value of its text", async () => {
    expect(await assigned(ids.acme)).toEqual({
      A: ["Prospect", "Software"],
      B: ["Prospect", "Software"],
      C: ["Prospect", "Retail"],
      D: ["Customer - Direct", null],
      E: ["Customer - Direct", null],
      F: ["Customer - Direct", "Retail"],
      G: ["Customer - Direct", "Retail"],
      H: [null, null],
      I: [null, "Software"],
    })
  })

  it("gives a list with no texts the defaults, per Organization", async () => {
    expect((await valuesOf(ids.globex, "industry")).map((v) => v.name)).toEqual(
      ["Retail"]
    )
    expect(await assigned(ids.globex)).toEqual({ Hooli: [null, "Retail"] })
    expect(
      (await valuesOf(ids.globex, "customer_type")).map((v) => v.name)
    ).toEqual([...DEFAULT_CUSTOMER_CLASSIFICATIONS.customer_type])
    for (const kind of ["customer_type", "industry"] as const) {
      expect(
        (await valuesOf(ids.initech, kind)).map((v) => [v.name, v.sequence])
      ).toEqual(DEFAULT_CUSTOMER_CLASSIFICATIONS[kind].map((n, i) => [n, i]))
    }
  })

  it("drops the free-text columns", async () => {
    const columns = await db.$client`
      select column_name from information_schema.columns
      where table_name = 'customers' and column_name in ('type', 'industry')`
    expect(columns).toHaveLength(0)
  })
})
