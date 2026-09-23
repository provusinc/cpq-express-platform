import { describe, expect, it } from "vitest"

import { eq, inArray, schema } from "@workspace/db"
import type { Db } from "@workspace/db"

import {
  createAccount,
  createContact,
  createMember,
  createOrganization,
  createUser,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const { accounts, contacts } = schema

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

const snapshotAccount = (db: Db, id: string) => () =>
  db.select().from(accounts).where(eq(accounts.id, id))

describe("account.create", () => {
  it("creates an Account with trimmed fields, blanks as null", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const account = await caller.account.create({
        name: "  Initech  ",
        type: "Prospect",
        industry: " Software ",
        website: "",
        billingCity: "Austin",
      })
      expect(account).toMatchObject({
        organizationId: organization.id,
        name: "Initech",
        type: "Prospect",
        industry: "Software",
        website: null,
        billingCity: "Austin",
        archived: false,
      })
    }))

  it("refuses a name that differs only by case and spaces", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      await createAccount(db, organization, { name: "Initech" })
      await expect(
        caller.account.create({ name: "  INITECH " })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "An Account named “Initech” already exists.",
      })
    }))

  it("allows the same name in another Organization", () =>
    withTestDb(async (db) => {
      const { caller } = await setup(db)
      await createAccount(db, await createOrganization(db), {
        name: "Initech",
      })
      await expect(
        caller.account.create({ name: "Initech" })
      ).resolves.toMatchObject({ name: "Initech" })
    }))

  it("enforces the unique name in the database too", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      await createAccount(db, organization, { name: "Initech" })
      await expect(
        db.transaction((tx) =>
          createAccount(tx, organization, { name: " initech" })
        )
      ).rejects.toMatchObject({
        cause: { constraint_name: "accounts_organization_id_name_key" },
      })
    }))

  it("rejects a blank name", () =>
    withTestDb(async (db) => {
      const { caller } = await setup(db)
      await expect(
        caller.account.create({ name: "   " })
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
        caller.account.create({ name: "Initech" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})

describe("account.update", () => {
  it("changes only the given fields", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const account = await createAccount(db, organization, {
        name: "Initech",
        industry: "Software",
        phone: "555",
      })
      const updated = await caller.account.update({
        id: account.id,
        name: "Initech Ltd",
        phone: "",
      })
      expect(updated).toMatchObject({
        name: "Initech Ltd",
        industry: "Software",
        phone: null,
      })
    }))

  it("may keep its own name in another case, but not take another's", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const account = await createAccount(db, organization, {
        name: "Initech",
      })
      await createAccount(db, organization, { name: "Globex" })
      await expect(
        caller.account.update({ id: account.id, name: "INITECH" })
      ).resolves.toMatchObject({ name: "INITECH" })
      await expect(
        caller.account.update({ id: account.id, name: "globex " })
      ).rejects.toMatchObject({ code: "CONFLICT" })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const account = await createAccount(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) =>
          caller.account.update({ id: account.id, name: "Hacked" }),
        snapshot: snapshotAccount(db, account.id),
      })
    }))
})

describe("account.list", () => {
  it("pages, searches and filters this Organization's Accounts", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const initech = await createAccount(db, organization, {
        name: "Initech",
        type: "Prospect",
        industry: "Software",
      })
      await createAccount(db, organization, {
        name: "acme",
        type: "Customer",
        industry: "Manufacturing",
      })
      await createAccount(db, organization, {
        name: "Umbrella",
        type: "Customer",
        industry: "Healthcare",
        archived: true,
      })
      await createAccount(db, await createOrganization(db), {
        name: "Elsewhere",
      })
      await createContact(db, initech, { name: "Peter", isPrimary: true })
      await createContact(db, initech, { name: "Milton" })

      const all = await caller.account.list({})
      expect(all).toMatchObject({ total: 2, page: 1, pageSize: 25 })
      expect(all.rows.map((r) => r.name)).toEqual(["acme", "Initech"])
      expect(all.rows[1]).toMatchObject({
        contactCount: 2,
        primaryContact: { name: "Peter" },
      })
      expect(all.rows[0]!.primaryContact).toBeNull()

      const page2 = await caller.account.list({ pageSize: 1, page: 2 })
      expect(page2.rows.map((r) => r.name)).toEqual(["Initech"])
      expect(page2.total).toBe(2)

      expect(
        (await caller.account.list({ search: "soft" })).rows.map((r) => r.name)
      ).toEqual(["Initech"])
      expect(
        (await caller.account.list({ type: "Customer" })).rows.map(
          (r) => r.name
        )
      ).toEqual(["acme"])
      expect(
        (await caller.account.list({ status: "archived" })).rows.map(
          (r) => r.name
        )
      ).toEqual(["Umbrella"])
      expect(
        (
          await caller.account.list({ status: "all", industry: "Healthcare" })
        ).rows.map((r) => r.name)
      ).toEqual(["Umbrella"])
    }))

  it("treats LIKE wildcards in the search literally", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      await createAccount(db, organization, { name: "100% Juice" })
      await createAccount(db, organization, { name: "1000 Things" })
      expect(
        (await caller.account.list({ search: "100%" })).rows.map((r) => r.name)
      ).toEqual(["100% Juice"])
    }))
})

describe("account.filterOptions", () => {
  it("lists the distinct types and industries in use", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      await createAccount(db, organization, {
        type: "Prospect",
        industry: "Software",
      })
      await createAccount(db, organization, { type: "Customer" })
      await createAccount(db, organization, { type: "Prospect" })
      await createAccount(db, await createOrganization(db), {
        type: "Elsewhere",
      })
      expect(await caller.account.filterOptions()).toEqual({
        types: ["Customer", "Prospect"],
        industries: ["Software"],
      })
    }))
})

describe("account.listForPicker", () => {
  it("hides archived Accounts unless asked for by id", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      await createAccount(db, organization, { name: "Initech" })
      const umbrella = await createAccount(db, organization, {
        name: "Umbrella",
        archived: true,
      })
      expect(
        (await caller.account.listForPicker({})).map((a) => a.name)
      ).toEqual(["Initech"])
      expect(
        (await caller.account.listForPicker({ includeId: umbrella.id })).map(
          (a) => a.name
        )
      ).toEqual(["Initech", "Umbrella"])
      expect(
        (await caller.account.listForPicker({ search: "umb" })).map(
          (a) => a.name
        )
      ).toEqual([])
    }))

  it("never includes another Organization's Account by id", () =>
    withTestDb(async (db) => {
      const { caller } = await setup(db)
      const theirs = await createAccount(db, await createOrganization(db))
      expect(
        await caller.account.listForPicker({ includeId: theirs.id })
      ).toEqual([])
    }))
})

describe("account.byId", () => {
  it("returns the Account with its Contacts, primary first", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const account = await createAccount(db, organization)
      await createContact(db, account, { name: "Alice" })
      await createContact(db, account, { name: "Zed", isPrimary: true })
      const found = await caller.account.byId({ id: account.id })
      expect(found).toMatchObject({ id: account.id, name: account.name })
      expect(found.contacts.map((c) => c.name)).toEqual(["Zed", "Alice"])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const account = await createAccount(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.account.byId({ id: account.id }),
      })
    }))
})

describe("account.archive / unarchive", () => {
  it("archives and restores an Account", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const account = await createAccount(db, organization)
      expect(await caller.account.archive({ id: account.id })).toMatchObject({
        archived: true,
      })
      expect(await caller.account.unarchive({ id: account.id })).toMatchObject({
        archived: false,
      })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const account = await createAccount(db, organization)
      const archived = await createAccount(db, organization, {
        archived: true,
      })
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.account.archive({ id: account.id }),
        snapshot: snapshotAccount(db, account.id),
      })
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.account.unarchive({ id: archived.id }),
        snapshot: snapshotAccount(db, archived.id),
      })
    }))
})

describe("account.delete", () => {
  it("deletes an unused Account and its Contacts", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const account = await createAccount(db, organization)
      await createContact(db, account)
      await caller.account.delete({ id: account.id })
      expect(await snapshotAccount(db, account.id)()).toEqual([])
      expect(
        await db
          .select()
          .from(contacts)
          .where(eq(contacts.accountId, account.id))
      ).toEqual([])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const account = await createAccount(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.account.delete({ id: account.id }),
        snapshot: snapshotAccount(db, account.id),
      })
    }))
})

describe("account.deleteMany", () => {
  it("deletes all the given Accounts", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const a = await createAccount(db, organization)
      const b = await createAccount(db, organization)
      const keep = await createAccount(db, organization)
      await caller.account.deleteMany({ ids: [a.id, b.id] })
      const left = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(inArray(accounts.id, [a.id, b.id, keep.id]))
      expect(left).toEqual([{ id: keep.id }])
    }))

  it("deletes nothing when any id isn't this Organization's", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const mine = await createAccount(db, organization)
      const other = await createOrganization(db)
      const theirs = await createAccount(db, other)
      const { user } = await createMember(db, other)
      // A member of `other` sends their own id plus one of ours.
      await expect(
        organizationCaller(db, {
          organization: other,
          user,
        }).account.deleteMany({ ids: [theirs.id, mine.id] })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      expect(await snapshotAccount(db, theirs.id)()).toHaveLength(1)
      expect(await snapshotAccount(db, mine.id)()).toHaveLength(1)
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const account = await createAccount(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.account.deleteMany({ ids: [account.id] }),
        snapshot: snapshotAccount(db, account.id),
      })
    }))
})
