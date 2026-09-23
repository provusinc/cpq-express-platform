import { describe, expect, it } from "vitest"

import { asc, eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"

import {
  createAccount,
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
  const account = await createAccount(db, organization)
  return {
    organization,
    account,
    caller: organizationCaller(db, { organization, user }),
  }
}

/** The Account's Contacts as (name, isPrimary), by name. */
const contactsOf = (db: Db, accountId: string) =>
  db
    .select({ name: contacts.name, isPrimary: contacts.isPrimary })
    .from(contacts)
    .where(eq(contacts.accountId, accountId))
    .orderBy(asc(contacts.name))

const snapshotContact = (db: Db, id: string) => () =>
  db.select().from(contacts).where(eq(contacts.id, id))

describe("contact.create", () => {
  it("makes the first Contact primary, later ones not", () =>
    withTestDb(async (db) => {
      const { account, caller } = await setup(db)
      const first = await caller.contact.create({
        accountId: account.id,
        name: "Peter Gibbons",
        email: "peter@initech.test",
        title: "Engineer",
      })
      expect(first).toMatchObject({
        accountId: account.id,
        name: "Peter Gibbons",
        email: "peter@initech.test",
        phone: null,
        isPrimary: true,
      })
      await caller.contact.create({ accountId: account.id, name: "Milton" })
      expect(await contactsOf(db, account.id)).toEqual([
        { name: "Milton", isPrimary: false },
        { name: "Peter Gibbons", isPrimary: true },
      ])
    }))

  it("moves the primary flag when created as primary", () =>
    withTestDb(async (db) => {
      const { account, caller } = await setup(db)
      await createContact(db, account, { name: "Alice", isPrimary: true })
      await caller.contact.create({
        accountId: account.id,
        name: "Bob",
        isPrimary: true,
      })
      expect(await contactsOf(db, account.id)).toEqual([
        { name: "Alice", isPrimary: false },
        { name: "Bob", isPrimary: true },
      ])
    }))

  it("rejects an invalid email", () =>
    withTestDb(async (db) => {
      const { account, caller } = await setup(db)
      await expect(
        caller.contact.create({
          accountId: account.id,
          name: "Bob",
          email: "not-an-email",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))

  it("allows at most one primary Contact per Account in the database", () =>
    withTestDb(async (db) => {
      const { account } = await setup(db)
      await createContact(db, account, { isPrimary: true })
      await expect(
        db.transaction((tx) => createContact(tx, account, { isPrimary: true }))
      ).rejects.toMatchObject({
        cause: { constraint_name: "contacts_one_primary_per_account" },
      })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, account } = await setup(db)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) =>
          caller.contact.create({ accountId: account.id, name: "Mallory" }),
        snapshot: () => contactsOf(db, account.id),
      })
    }))
})

describe("contact.update", () => {
  it("changes only the given fields", () =>
    withTestDb(async (db) => {
      const { account, caller } = await setup(db)
      const contact = await createContact(db, account, {
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
      const { organization, account } = await setup(db)
      const contact = await createContact(db, account)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) =>
          caller.contact.update({ id: contact.id, name: "Hacked" }),
        snapshot: snapshotContact(db, contact.id),
      })
    }))
})

describe("contact.setPrimary", () => {
  it("makes this the only primary Contact of its Account", () =>
    withTestDb(async (db) => {
      const { account, caller } = await setup(db)
      await createContact(db, account, { name: "Alice", isPrimary: true })
      const bob = await createContact(db, account, { name: "Bob" })
      // Another Account's primary is untouched.
      const other = await createAccount(db, { id: account.organizationId })
      await createContact(db, other, { name: "Carol", isPrimary: true })

      await caller.contact.setPrimary({ id: bob.id })
      expect(await contactsOf(db, account.id)).toEqual([
        { name: "Alice", isPrimary: false },
        { name: "Bob", isPrimary: true },
      ])
      expect(await contactsOf(db, other.id)).toEqual([
        { name: "Carol", isPrimary: true },
      ])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, account } = await setup(db)
      await createContact(db, account, { name: "Alice", isPrimary: true })
      const bob = await createContact(db, account, { name: "Bob" })
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.contact.setPrimary({ id: bob.id }),
        snapshot: () => contactsOf(db, account.id),
      })
    }))
})

describe("contact.delete", () => {
  it("deletes a Contact, even the primary one", () =>
    withTestDb(async (db) => {
      const { account, caller } = await setup(db)
      const contact = await createContact(db, account, { isPrimary: true })
      await caller.contact.delete({ id: contact.id })
      expect(await snapshotContact(db, contact.id)()).toEqual([])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, account } = await setup(db)
      const contact = await createContact(db, account)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.contact.delete({ id: contact.id }),
        snapshot: snapshotContact(db, contact.id),
      })
    }))
})
