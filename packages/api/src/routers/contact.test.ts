import { describe, expect, it } from "vitest"

import { asc, eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"

import {
  createCustomer,
  createContact,
  createMember,
  createOrganization,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const { contacts } = schema

async function setup(db: Db) {
  const organization = await createOrganization(db)
  const { user } = await createMember(db, organization)
  const customer = await createCustomer(db, organization)
  return {
    organization,
    customer,
    caller: organizationCaller(db, { organization, user }),
  }
}

/** The Customer's Contacts as (name, isPrimary), by name. */
const contactsOf = (db: Db, customerId: string) =>
  db
    .select({ name: contacts.name, isPrimary: contacts.isPrimary })
    .from(contacts)
    .where(eq(contacts.customerId, customerId))
    .orderBy(asc(contacts.name))

const snapshotContact = (db: Db, id: string) => () =>
  db.select().from(contacts).where(eq(contacts.id, id))

describe("contact.create", () => {
  it("makes the first Contact primary, later ones not", () =>
    withTestDb(async (db) => {
      const { customer, caller } = await setup(db)
      const first = await caller.contact.create({
        customerId: customer.id,
        name: "Peter Gibbons",
        email: "peter@initech.test",
        title: "Engineer",
      })
      expect(first).toMatchObject({
        customerId: customer.id,
        name: "Peter Gibbons",
        email: "peter@initech.test",
        phone: null,
        isPrimary: true,
      })
      await caller.contact.create({ customerId: customer.id, name: "Milton" })
      expect(await contactsOf(db, customer.id)).toEqual([
        { name: "Milton", isPrimary: false },
        { name: "Peter Gibbons", isPrimary: true },
      ])
    }))

  it("moves the primary flag when created as primary", () =>
    withTestDb(async (db) => {
      const { customer, caller } = await setup(db)
      await createContact(db, customer, { name: "Alice", isPrimary: true })
      await caller.contact.create({
        customerId: customer.id,
        name: "Bob",
        isPrimary: true,
      })
      expect(await contactsOf(db, customer.id)).toEqual([
        { name: "Alice", isPrimary: false },
        { name: "Bob", isPrimary: true },
      ])
    }))

  it("rejects an invalid email", () =>
    withTestDb(async (db) => {
      const { customer, caller } = await setup(db)
      await expect(
        caller.contact.create({
          customerId: customer.id,
          name: "Bob",
          email: "not-an-email",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))

  it("allows at most one primary Contact per Customer in the database", () =>
    withTestDb(async (db) => {
      const { customer } = await setup(db)
      await createContact(db, customer, { isPrimary: true })
      await expect(
        db.transaction((tx) => createContact(tx, customer, { isPrimary: true }))
      ).rejects.toMatchObject({
        cause: { constraint_name: "contacts_one_primary_per_customer" },
      })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, customer } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) =>
          caller.contact.create({ customerId: customer.id, name: "Mallory" }),
        snapshot: () => contactsOf(db, customer.id),
      })
    }))
})

describe("contact.update", () => {
  it("changes only the given fields", () =>
    withTestDb(async (db) => {
      const { customer, caller } = await setup(db)
      const contact = await createContact(db, customer, {
        name: "Alice",
        phone: "555",
        title: "CTO",
      })
      expect(
        await caller.contact.update({ id: contact.id, title: "CEO", phone: "" })
      ).toMatchObject({ name: "Alice", title: "CEO", phone: null })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, customer } = await setup(db)
      const contact = await createContact(db, customer)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) =>
          caller.contact.update({ id: contact.id, name: "Hacked" }),
        snapshot: snapshotContact(db, contact.id),
      })
    }))
})

describe("contact.setPrimary", () => {
  it("makes this the only primary Contact of its Customer", () =>
    withTestDb(async (db) => {
      const { customer, caller } = await setup(db)
      await createContact(db, customer, { name: "Alice", isPrimary: true })
      const bob = await createContact(db, customer, { name: "Bob" })
      // Another Customer's primary is untouched.
      const other = await createCustomer(db, { id: customer.organizationId })
      await createContact(db, other, { name: "Carol", isPrimary: true })

      await caller.contact.setPrimary({ id: bob.id })
      expect(await contactsOf(db, customer.id)).toEqual([
        { name: "Alice", isPrimary: false },
        { name: "Bob", isPrimary: true },
      ])
      expect(await contactsOf(db, other.id)).toEqual([
        { name: "Carol", isPrimary: true },
      ])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, customer } = await setup(db)
      await createContact(db, customer, { name: "Alice", isPrimary: true })
      const bob = await createContact(db, customer, { name: "Bob" })
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.contact.setPrimary({ id: bob.id }),
        snapshot: () => contactsOf(db, customer.id),
      })
    }))
})

describe("contact.delete", () => {
  it("deletes a Contact, even the primary one", () =>
    withTestDb(async (db) => {
      const { customer, caller } = await setup(db)
      const contact = await createContact(db, customer, { isPrimary: true })
      await caller.contact.delete({ id: contact.id })
      expect(await snapshotContact(db, contact.id)()).toEqual([])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, customer } = await setup(db)
      const contact = await createContact(db, customer)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.contact.delete({ id: contact.id }),
        snapshot: snapshotContact(db, contact.id),
      })
    }))
})
