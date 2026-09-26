/**
 * The Catalog Types migration (0022/0023, #30) against data in the old
 * shape: a scratch database is migrated up to 0021, filled with Products,
 * Add-ons, their Line Items, a cost log entry and Label Overrides (renamed
 * and hidden terms), then migrated to the end, and the types, references and
 * kinds are checked.
 */
import { readFileSync } from "node:fs"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { asc, createDb, eq, schema, uuidv7 } from "@workspace/db"
import type { Database } from "@workspace/db"
import { migrationsFolder } from "@workspace/db/migrate"

/** The last migration with the fixed Product / Add-on kinds. */
const LEGACY_THROUGH = "0021_customer_classifications_drop_text"

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
  acme: uuidv7(),
  globex: uuidv7(),
  initech: uuidv7(),
  user: uuidv7(),
  customer: uuidv7(),
  status: uuidv7(),
  quote: uuidv7(),
  gateway: uuidv7(),
  training: uuidv7(),
  globexItem: uuidv7(),
  role: uuidv7(),
  productLine: uuidv7(),
  addOnLine: uuidv7(),
  roleLine: uuidv7(),
}

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL!
  admin = createDb(url, { max: 1 })
  await admin.$client.unsafe(`create database "${name}"`)
  const scratch = new URL(url)
  scratch.pathname = `/${name}`
  db = createDb(scratch.toString(), { max: 1 })
  await apply(db, legacyTags)

  const sql = db.$client
  // Acme renamed Products and Resource Roles and hid Add-ons; Globex renamed
  // only the Add-on plural; Initech has no overrides and no items.
  await sql`insert into organizations (id, slug, name, currency_code) values
    (${ids.acme}, 'acme', 'Acme', 'USD'),
    (${ids.globex}, 'globex', 'Globex', 'EUR'),
    (${ids.initech}, 'initech', 'Initech', 'USD')`
  await sql`insert into label_overrides (id, organization_id, term, singular, plural, enabled) values
    (${uuidv7()}, ${ids.acme}, 'product', 'Device', 'Devices', true),
    (${uuidv7()}, ${ids.acme}, 'add_on', null, null, false),
    (${uuidv7()}, ${ids.acme}, 'resource_role', 'Consultant', null, true),
    (${uuidv7()}, ${ids.globex}, 'add_on', '  ', 'Extras', true)`
  await sql`insert into catalog_items (id, organization_id, kind, name, price, cost, billing_unit) values
    (${ids.gateway}, ${ids.acme}, 'product', 'Gateway', 100, 60, 'each'),
    (${ids.training}, ${ids.acme}, 'add_on', 'Training', 80, 50, 'hour'),
    (${ids.globexItem}, ${ids.globex}, 'add_on', 'Setup', 10, 5, 'each')`
  await sql`insert into resource_roles (id, organization_id, name, bill_rate, cost_rate)
    values (${ids.role}, ${ids.acme}, 'Architect', 150, 100)`
  await sql`insert into users (id, email) values (${ids.user}, 'owner@acme.test')`
  await sql`insert into customers (id, organization_id, name)
    values (${ids.customer}, ${ids.acme}, 'Initrode')`
  await sql`insert into quote_statuses (id, organization_id, stage, name, sequence)
    values (${ids.status}, ${ids.acme}, 'draft', 'Draft', 0)`
  await sql`insert into quotes (id, organization_id, owner_id, created_by_id, updated_by_id,
      customer_id, name, start_date, end_date, currency_code, stage, status_id)
    values (${ids.quote}, ${ids.acme}, ${ids.user}, ${ids.user}, ${ids.user}, ${ids.customer},
      'Q', '2026-10-01', '2026-12-31', 'USD', 'draft', ${ids.status})`
  const line = (
    id: string,
    kind: string,
    unit: string,
    catalogItemId: string | null,
    resourceRoleId: string | null
  ) => sql`insert into line_items (id, organization_id, quote_id, source_kind,
      catalog_item_id, resource_role_id, name, start_date, end_date, billing_unit,
      base_price, base_cost, unit_price, unit_cost, quantity)
    values (${id}, ${ids.acme}, ${ids.quote}, ${kind}, ${catalogItemId}, ${resourceRoleId},
      'Line', '2026-10-01', '2026-12-31', ${unit}, 1, 1, 1, 1, 1)`
  await line(ids.productLine, "product", "each", ids.gateway, null)
  await line(ids.addOnLine, "add_on", "hour", ids.training, null)
  await line(ids.roleLine, "resource_role", "hour", null, ids.role)
  await sql`insert into cost_change_log (id, organization_id, quote_id, line_item_id,
      source_kind, source_id, source_name, old_cost, new_cost, actor_id)
    values (${uuidv7()}, ${ids.acme}, ${ids.quote}, ${ids.productLine}, 'product',
      ${ids.gateway}, 'Gateway', 50, 60, ${ids.user})`

  await apply(db, laterTags)
}, 60_000)

afterAll(async () => {
  await db?.$client.end()
  await admin?.$client.unsafe(`drop database if exists "${name}" with (force)`)
  await admin?.$client.end()
})

const { catalogTypes, catalogItems, lineItems, costChangeLog, labelOverrides } =
  schema

const typesOf = (organizationId: string) =>
  db
    .select()
    .from(catalogTypes)
    .where(eq(catalogTypes.organizationId, organizationId))
    .orderBy(asc(catalogTypes.sequence))

const facts = (types: Awaited<ReturnType<typeof typesOf>>) =>
  types.map((t) => ({
    singular: t.singular,
    plural: t.plural,
    billingUnits: t.billingUnits,
    colourIndex: t.colourIndex,
    active: t.active,
  }))

describe("the Catalog Types migration", () => {
  it("gives every Organization Product (Each) and Add-on (Each, Hour)", async () => {
    expect(facts(await typesOf(ids.initech))).toEqual([
      {
        singular: "Product",
        plural: "Products",
        billingUnits: ["each"],
        colourIndex: 0,
        active: true,
      },
      {
        singular: "Add-on",
        plural: "Add-ons",
        billingUnits: ["each", "hour"],
        colourIndex: 1,
        active: true,
      },
    ])
    // UUIDv7 ids.
    for (const type of await typesOf(ids.initech)) expect(type.id[14]).toBe("7")
  })

  it("names the types by their Label Overrides and makes a hidden term inactive", async () => {
    expect(
      facts(await typesOf(ids.acme)).map((t) => [
        t.singular,
        t.plural,
        t.active,
      ])
    ).toEqual([
      ["Device", "Devices", true],
      ["Add-on", "Add-ons", false],
    ])
    expect(
      facts(await typesOf(ids.globex)).map((t) => [
        t.singular,
        t.plural,
        t.active,
      ])
    ).toEqual([
      ["Product", "Products", true],
      ["Add-on", "Extras", true],
    ])
  })

  it("points every Catalog Item at the type of its kind", async () => {
    const [device, addOn] = await typesOf(ids.acme)
    const [, globexAddOn] = await typesOf(ids.globex)
    const items = await db.select().from(catalogItems)
    const typeOf = (id: string) => items.find((i) => i.id === id)!.catalogTypeId
    expect(typeOf(ids.gateway)).toBe(device!.id)
    expect(typeOf(ids.training)).toBe(addOn!.id)
    expect(typeOf(ids.globexItem)).toBe(globexAddOn!.id)
    const columns = await db.$client`
      select column_name from information_schema.columns
      where table_name = 'catalog_items' and column_name = 'kind'`
    expect(columns).toHaveLength(0)
  })

  it("collapses the Line Item and cost log kinds into catalog_item", async () => {
    const lines = await db.select().from(lineItems)
    expect(Object.fromEntries(lines.map((l) => [l.id, l.sourceKind]))).toEqual({
      [ids.productLine]: "catalog_item",
      [ids.addOnLine]: "catalog_item",
      [ids.roleLine]: "resource_role",
    })
    expect(
      (await db.select().from(costChangeLog)).map((e) => e.sourceKind)
    ).toEqual(["catalog_item"])
  })

  it("removes the Product and Add-on Label Overrides, keeping the others", async () => {
    expect(
      (await db.select().from(labelOverrides)).map((o) => [
        o.organizationId,
        o.term,
        o.singular,
      ])
    ).toEqual([[ids.acme, "resource_role", "Consultant"]])
  })
})
