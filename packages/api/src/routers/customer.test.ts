import { describe, expect, it } from "vitest"

import { eq, inArray, schema } from "@workspace/db"
import type { Db } from "@workspace/db"

import {
  createCustomer,
  createContact,
  createMember,
  createOrganization,
  createQuote,
  createUser,
  customerClassification,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const { customers, contacts } = schema

/** An Organization and a caller for one of its Members. */
async function setup(db: Db) {
  const organization = await createOrganization(db)
  const { user } = await createMember(db, organization)
  return {
    organization,
    user,
    caller: organizationCaller(db, { organization, user }),
  }
}

const snapshotCustomer = (db: Db, id: string) => () =>
  db.select().from(customers).where(eq(customers.id, id))

describe("customer.create", () => {
  it("creates a Customer with trimmed fields, blanks as null", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const prospect = await customerClassification(
        db,
        organization,
        "customer_type",
        "Prospect"
      )
      const technology = await customerClassification(
        db,
        organization,
        "industry",
        "Technology"
      )
      const customer = await caller.customer.create({
        name: "  Initech  ",
        customerTypeId: prospect,
        industryId: technology,
        website: "",
        billingCity: "Austin",
      })
      expect(customer).toMatchObject({
        organizationId: organization.id,
        name: "Initech",
        customerTypeId: prospect,
        industryId: technology,
        website: null,
        billingCity: "Austin",
        archived: false,
      })
      expect(await caller.customer.byId({ id: customer.id })).toMatchObject({
        customerType: { id: prospect, name: "Prospect", retired: false },
        industry: { id: technology, name: "Technology", retired: false },
      })
    }))

  it("refuses a value of the other list, another Organization's or a retired one", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const technology = await customerClassification(
        db,
        organization,
        "industry",
        "Technology"
      )
      const theirs = await customerClassification(
        db,
        await createOrganization(db),
        "customer_type",
        "Prospect"
      )
      const lead = await customerClassification(
        db,
        organization,
        "customer_type",
        "Lead",
        { retired: true }
      )
      await expect(
        caller.customer.create({ name: "A", customerTypeId: technology })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(
        caller.customer.create({ name: "B", customerTypeId: theirs })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      await expect(
        caller.customer.create({ name: "C", customerTypeId: lead })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Customer Type “Lead” is retired. Pick another value.",
      })
    }))

  it("refuses a name that differs only by case and spaces", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      await createCustomer(db, organization, { name: "Initech" })
      await expect(
        caller.customer.create({ name: "  INITECH " })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "A Customer named “Initech” already exists.",
      })
    }))

  it("allows the same name in another Organization", () =>
    withTestDb(async (db) => {
      const { caller } = await setup(db)
      await createCustomer(db, await createOrganization(db), {
        name: "Initech",
      })
      await expect(
        caller.customer.create({ name: "Initech" })
      ).resolves.toMatchObject({ name: "Initech" })
    }))

  it("enforces the unique name in the database too", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      await createCustomer(db, organization, { name: "Initech" })
      await expect(
        db.transaction((tx) =>
          createCustomer(tx, organization, { name: " initech" })
        )
      ).rejects.toMatchObject({
        cause: { constraint_name: "customers_organization_id_name_key" },
      })
    }))

  it("rejects a blank name", () =>
    withTestDb(async (db) => {
      const { caller } = await setup(db)
      await expect(
        caller.customer.create({ name: "   " })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))

  it("refuses a non-member", () =>
    withTestDb(async (db) => {
      const organization = await createOrganization(db)
      const caller = organizationCaller(db, {
        organization,
        user: await createUser(db),
      })
      await expect(
        caller.customer.create({ name: "Initech" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})

describe("customer.update", () => {
  it("changes only the given fields", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const software = await customerClassification(
        db,
        organization,
        "industry",
        "Software"
      )
      const customer = await createCustomer(db, organization, {
        name: "Initech",
        industryId: software,
        phone: "555",
      })
      const updated = await caller.customer.update({
        id: customer.id,
        name: "Initech Ltd",
        phone: "",
      })
      expect(updated).toMatchObject({
        name: "Initech Ltd",
        industryId: software,
        phone: null,
      })
    }))

  it("keeps a retired value until it is changed, then can't go back", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const lead = await customerClassification(
        db,
        organization,
        "customer_type",
        "Lead",
        { retired: true }
      )
      const partner = await customerClassification(
        db,
        organization,
        "customer_type",
        "Partner"
      )
      const customer = await createCustomer(db, organization, {
        customerTypeId: lead,
      })
      // The dialog sends every field back: the retired value is kept.
      await expect(
        caller.customer.update({ id: customer.id, customerTypeId: lead })
      ).resolves.toMatchObject({ customerTypeId: lead })
      expect(await caller.customer.byId({ id: customer.id })).toMatchObject({
        customerType: { name: "Lead", retired: true },
      })
      await caller.customer.update({ id: customer.id, customerTypeId: partner })
      await expect(
        caller.customer.update({ id: customer.id, customerTypeId: lead })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      await expect(
        caller.customer.update({ id: customer.id, customerTypeId: null })
      ).resolves.toMatchObject({ customerTypeId: null })
    }))

  it("may keep its own name in another case, but not take another's", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const customer = await createCustomer(db, organization, {
        name: "Initech",
      })
      await createCustomer(db, organization, { name: "Globex" })
      await expect(
        caller.customer.update({ id: customer.id, name: "INITECH" })
      ).resolves.toMatchObject({ name: "INITECH" })
      await expect(
        caller.customer.update({ id: customer.id, name: "globex " })
      ).rejects.toMatchObject({ code: "CONFLICT" })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const customer = await createCustomer(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) =>
          caller.customer.update({ id: customer.id, name: "Hacked" }),
        snapshot: snapshotCustomer(db, customer.id),
      })
    }))
})

describe("customer.list", () => {
  it("pages, searches and filters this Organization's Customers", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const value = (kind: "customer_type" | "industry", name: string) =>
        customerClassification(db, organization, kind, name)
      const prospect = await value("customer_type", "Prospect")
      const customerType = await value("customer_type", "Customer")
      const software = await value("industry", "Software")
      const healthcare = await value("industry", "Healthcare")
      const initech = await createCustomer(db, organization, {
        name: "Initech",
        customerTypeId: prospect,
        industryId: software,
      })
      await createCustomer(db, organization, {
        name: "acme",
        customerTypeId: customerType,
        industryId: await value("industry", "Manufacturing"),
      })
      await createCustomer(db, organization, {
        name: "Umbrella",
        customerTypeId: customerType,
        industryId: healthcare,
        archived: true,
      })
      await createCustomer(db, await createOrganization(db), {
        name: "Elsewhere",
      })
      await createContact(db, initech, { name: "Peter", isPrimary: true })
      await createContact(db, initech, { name: "Milton" })

      const all = await caller.customer.list({})
      expect(all).toMatchObject({ total: 2, page: 1, pageSize: 25 })
      expect(all.statusCounts).toEqual({ active: 2, archived: 1, all: 3 })
      expect(
        (
          await caller.customer.list({
            status: "archived",
            customerTypeIds: [customerType],
          })
        ).statusCounts
      ).toEqual({ active: 1, archived: 1, all: 2 })
      expect(all.rows.map((r) => r.name)).toEqual(["acme", "Initech"])
      expect(all.rows[1]).toMatchObject({
        contactCount: 2,
        primaryContact: { name: "Peter" },
        customerType: { id: prospect, name: "Prospect", retired: false },
        industry: { id: software, name: "Software", retired: false },
      })
      expect(all.rows[0]!.primaryContact).toBeNull()

      const page2 = await caller.customer.list({ pageSize: 1, page: 2 })
      expect(page2.rows.map((r) => r.name)).toEqual(["Initech"])
      expect(page2.total).toBe(2)

      // Search matches the Industry's name.
      expect(
        (await caller.customer.list({ search: "soft" })).rows.map((r) => r.name)
      ).toEqual(["Initech"])
      expect(
        (
          await caller.customer.list({ customerTypeIds: [customerType] })
        ).rows.map((r) => r.name)
      ).toEqual(["acme"])
      expect(
        (
          await caller.customer.list({
            customerTypeIds: [customerType, prospect],
          })
        ).rows.map((r) => r.name)
      ).toEqual(["acme", "Initech"])
      expect(
        (await caller.customer.list({ status: "archived" })).rows.map(
          (r) => r.name
        )
      ).toEqual(["Umbrella"])
      expect(
        (
          await caller.customer.list({
            status: "all",
            industryIds: [healthcare],
          })
        ).rows.map((r) => r.name)
      ).toEqual(["Umbrella"])
    }))

  it("treats LIKE wildcards in the search literally", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      await createCustomer(db, organization, { name: "100% Juice" })
      await createCustomer(db, organization, { name: "1000 Things" })
      expect(
        (await caller.customer.list({ search: "100%" })).rows.map((r) => r.name)
      ).toEqual(["100% Juice"])
    }))
})

describe("customer.listForPicker", () => {
  it("hides archived Customers unless asked for by id", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      await createCustomer(db, organization, { name: "Initech" })
      const umbrella = await createCustomer(db, organization, {
        name: "Umbrella",
        archived: true,
      })
      expect(
        (await caller.customer.listForPicker({})).map((a) => a.name)
      ).toEqual(["Initech"])
      expect(
        (await caller.customer.listForPicker({ includeId: umbrella.id })).map(
          (a) => a.name
        )
      ).toEqual(["Initech", "Umbrella"])
      expect(
        (await caller.customer.listForPicker({ search: "umb" })).map(
          (a) => a.name
        )
      ).toEqual([])
    }))

  it("never includes another Organization's Customer by id", () =>
    withTestDb(async (db) => {
      const { caller } = await setup(db)
      const theirs = await createCustomer(db, await createOrganization(db))
      expect(
        await caller.customer.listForPicker({ includeId: theirs.id })
      ).toEqual([])
    }))
})

describe("customer.byId", () => {
  it("returns the Customer with its Contacts, primary first", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const customer = await createCustomer(db, organization)
      await createContact(db, customer, { name: "Alice" })
      await createContact(db, customer, { name: "Zed", isPrimary: true })
      const found = await caller.customer.byId({ id: customer.id })
      expect(found).toMatchObject({ id: customer.id, name: customer.name })
      expect(found.contacts.map((c) => c.name)).toEqual(["Zed", "Alice"])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const customer = await createCustomer(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.customer.byId({ id: customer.id }),
      })
    }))
})

describe("customer.archive / unarchive", () => {
  it("archives and restores a Customer", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const customer = await createCustomer(db, organization)
      expect(await caller.customer.archive({ id: customer.id })).toMatchObject({
        archived: true,
      })
      expect(
        await caller.customer.unarchive({ id: customer.id })
      ).toMatchObject({
        archived: false,
      })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const customer = await createCustomer(db, organization)
      const archived = await createCustomer(db, organization, {
        archived: true,
      })
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.customer.archive({ id: customer.id }),
        snapshot: snapshotCustomer(db, customer.id),
      })
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.customer.unarchive({ id: archived.id }),
        snapshot: snapshotCustomer(db, archived.id),
      })
    }))
})

describe("customer.delete", () => {
  it("deletes an unused Customer and its Contacts", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const customer = await createCustomer(db, organization)
      await createContact(db, customer)
      await caller.customer.delete({ id: customer.id })
      expect(await snapshotCustomer(db, customer.id)()).toEqual([])
      expect(
        await db
          .select()
          .from(contacts)
          .where(eq(contacts.customerId, customer.id))
      ).toEqual([])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const customer = await createCustomer(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.customer.delete({ id: customer.id }),
        snapshot: snapshotCustomer(db, customer.id),
      })
    }))
})

describe("deleting a Customer with Quotes", () => {
  /** A Customer with `n` Quotes named "Quote 1"… (newest last). */
  async function quotedCustomer(db: Db, n: number) {
    const s = await setup(db)
    const customer = await createCustomer(db, s.organization, {
      name: "Initech",
    })
    for (let i = 1; i <= n; i++) {
      await createQuote(db, s.organization, {
        owner: s.user,
        customer,
        name: `Quote ${i}`,
        createdAt: new Date(Date.UTC(2026, 0, i)),
      })
    }
    return { ...s, customer }
  }

  it("delete is refused with the structured in-use error", () =>
    withTestDb(async (db) => {
      const { caller, customer } = await quotedCustomer(db, 7)
      const error = await caller.customer
        .delete({ id: customer.id })
        .catch((e: unknown) => e)
      expect(error).toMatchObject({ code: "CONFLICT" })
      const cause = (error as { cause?: { details?: unknown } }).cause
      expect(cause?.details).toEqual({
        kind: "in_use",
        entity: "customer",
        name: "Initech",
        counts: { quotes: 7 },
        // The newest five.
        examples: ["Quote 7", "Quote 6", "Quote 5", "Quote 4", "Quote 3"],
        suggestion: "archive",
      })
      expect((error as Error).message).toMatch(/used by 7 Quotes.*Archive/)
      expect(await snapshotCustomer(db, customer.id)()).toHaveLength(1)
    }))

  it("deleteMany deletes nothing when any Customer has Quotes", () =>
    withTestDb(async (db) => {
      const { organization, caller, customer } = await quotedCustomer(db, 1)
      const unused = await createCustomer(db, organization)
      await expect(
        caller.customer.deleteMany({ ids: [unused.id, customer.id] })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: /1 Quote \(Quote 1\)/,
      })
      expect(await snapshotCustomer(db, unused.id)()).toHaveLength(1)
    }))

  it("the database RESTRICTs it too", () =>
    withTestDb(async (db) => {
      const { customer } = await quotedCustomer(db, 1)
      await expect(
        db.transaction((tx) =>
          tx.delete(customers).where(eq(customers.id, customer.id))
        )
      ).rejects.toThrow()
      expect(await snapshotCustomer(db, customer.id)()).toHaveLength(1)
    }))

  it("archiving still works", () =>
    withTestDb(async (db) => {
      const { caller, customer } = await quotedCustomer(db, 1)
      await expect(
        caller.customer.archive({ id: customer.id })
      ).resolves.toMatchObject({ archived: true })
    }))
})

describe("customer.deleteMany", () => {
  it("deletes all the given Customers", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const a = await createCustomer(db, organization)
      const b = await createCustomer(db, organization)
      const keep = await createCustomer(db, organization)
      await caller.customer.deleteMany({ ids: [a.id, b.id] })
      const left = await db
        .select({ id: customers.id })
        .from(customers)
        .where(inArray(customers.id, [a.id, b.id, keep.id]))
      expect(left).toEqual([{ id: keep.id }])
    }))

  it("deletes nothing when any id isn't this Organization's", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const mine = await createCustomer(db, organization)
      const other = await createOrganization(db)
      const theirs = await createCustomer(db, other)
      const { user } = await createMember(db, other)
      // A member of `other` sends their own id plus one of ours.
      await expect(
        organizationCaller(db, {
          organization: other,
          user,
        }).customer.deleteMany({ ids: [theirs.id, mine.id] })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      expect(await snapshotCustomer(db, theirs.id)()).toHaveLength(1)
      expect(await snapshotCustomer(db, mine.id)()).toHaveLength(1)
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const customer = await createCustomer(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.customer.deleteMany({ ids: [customer.id] }),
        snapshot: snapshotCustomer(db, customer.id),
      })
    }))
})
