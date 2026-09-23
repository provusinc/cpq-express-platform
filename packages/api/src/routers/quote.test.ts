import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import { LOCKED_STATUSES } from "@workspace/domain/status"
import type { QuoteStatus, Role } from "@workspace/domain/enums"

import {
  createAccount,
  createMember,
  createOrganization,
  createQuote,
  createUser,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const { memberships, quotes } = schema

const snapshotQuote = (db: Db, id: string) => () =>
  db.select().from(quotes).where(eq(quotes.id, id))

/** An Organization with one member per Role, and a caller for each. */
async function setup(db: Db) {
  const organization = await createOrganization(db, { currencyCode: "EUR" })
  const members = {
    admin: await createMember(db, organization, { role: "admin" }),
    manager: await createMember(db, organization, { role: "manager" }),
    member: await createMember(db, organization, { role: "member" }),
    otherMember: await createMember(db, organization, { role: "member" }),
    otherManager: await createMember(db, organization, { role: "manager" }),
  }
  const caller = (who: keyof typeof members) =>
    organizationCaller(db, { organization, user: members[who].user })
  return { organization, members, caller }
}

const newQuote = (accountId: string) => ({
  accountId,
  name: "Pilot",
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  validUntil: "2026-10-31",
  timePeriod: "months" as const,
})

describe("quote.create", () => {
  it("creates a Draft owned by the caller in the Organization's currency", () =>
    withTestDb(async (db) => {
      const { organization, members, caller } = await setup(db)
      const account = await createAccount(db, organization)
      const created = await caller("member").quote.create({
        ...newQuote(account.id),
        name: "  Pilot  ",
        description: " Phase one ",
      })
      const [row] = await snapshotQuote(db, created.id)()
      expect(row).toMatchObject({
        id: created.id,
        name: "Pilot",
        description: "Phase one",
        accountId: account.id,
        status: "draft",
        currencyCode: "EUR",
        startDate: "2026-10-01",
        endDate: "2026-12-31",
        validUntil: "2026-10-31",
        timePeriod: "months",
        ownerId: members.member.user.id,
        createdById: members.member.user.id,
        updatedById: members.member.user.id,
        discountKind: null,
        discountValue: null,
        subtotal: "0.0000",
        total: "0.0000",
        marginPct: "0.0000",
      })
    }))

  it("allows the same Name twice (Names aren't unique)", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const account = await createAccount(db, organization)
      await caller("member").quote.create(newQuote(account.id))
      await expect(
        caller("member").quote.create(newQuote(account.id))
      ).resolves.toMatchObject({ name: "Pilot" })
    }))

  it("rejects an end date before the start date, and malformed dates", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const account = await createAccount(db, organization)
      for (const dates of [
        { startDate: "2026-10-02", endDate: "2026-10-01" },
        { startDate: "2026-02-30", endDate: "2026-10-01" },
        { startDate: "10/01/2026", endDate: "2026-10-01" },
      ]) {
        await expect(
          caller("member").quote.create({ ...newQuote(account.id), ...dates }),
          JSON.stringify(dates)
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
    }))

  it("allows a one-day Quote and no Valid Until", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const account = await createAccount(db, organization)
      const { id } = await caller("member").quote.create({
        ...newQuote(account.id),
        endDate: "2026-10-01",
        validUntil: null,
      })
      const [row] = await snapshotQuote(db, id)()
      expect(row).toMatchObject({ endDate: "2026-10-01", validUntil: null })
    }))

  it("refuses an archived Account", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const account = await createAccount(db, organization, { archived: true })
      await expect(
        caller("member").quote.create(newQuote(account.id))
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    }))

  it("is isolated from other Organizations' Accounts", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const account = await createAccount(db, acme)
      await expectIsolated(db, {
        owner: acme,
        call: (caller) => caller.quote.create(newQuote(account.id)),
        snapshot: () =>
          db.select().from(quotes).where(eq(quotes.accountId, account.id)),
      })
    }))
})

describe("quote.nameTaken", () => {
  it("warns when the Account has a Quote with that Name, ignoring case and spaces", () =>
    withTestDb(async (db) => {
      const { organization, members, caller } = await setup(db)
      const account = await createAccount(db, organization)
      const other = await createAccount(db, organization)
      const quote = await createQuote(db, organization, {
        owner: members.admin.user,
        account,
        name: "Pilot",
      })
      const taken = (input: {
        accountId: string
        name: string
        exceptId?: string
      }) => caller("member").quote.nameTaken(input)
      expect(await taken({ accountId: account.id, name: " pilot " })).toEqual({
        taken: true,
        count: 1,
      })
      expect(await taken({ accountId: account.id, name: "Pilot 2" })).toEqual({
        taken: false,
        count: 0,
      })
      expect(await taken({ accountId: other.id, name: "Pilot" })).toEqual({
        taken: false,
        count: 0,
      })
      expect(
        await taken({
          accountId: account.id,
          name: "Pilot",
          exceptId: quote.id,
        })
      ).toEqual({ taken: false, count: 0 })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme)
      const account = await createAccount(db, acme)
      await createQuote(db, acme, { owner: user, account, name: "Secret" })
      await expectIsolated(db, {
        owner: acme,
        call: (caller) =>
          caller.quote.nameTaken({ accountId: account.id, name: "Secret" }),
      })
    }))
})

describe("quote.list", () => {
  /** Three Quotes with distinct names, Accounts, owners, statuses and dates. */
  async function listSetup(db: Db) {
    const s = await setup(db)
    const initech = await createAccount(db, s.organization, { name: "Initech" })
    const globex = await createAccount(db, s.organization, { name: "Globex" })
    const alpha = await createQuote(db, s.organization, {
      owner: s.members.member.user,
      account: initech,
      name: "Alpha rollout",
      description: "Warehouse robots",
      status: "draft",
      validUntil: "2000-01-01",
      createdAt: new Date("2026-01-10T12:00:00Z"),
    })
    const beta = await createQuote(db, s.organization, {
      owner: s.members.manager.user,
      account: globex,
      name: "Beta support",
      status: "approved",
      validUntil: "2999-01-01",
      createdAt: new Date("2026-02-10T12:00:00Z"),
    })
    const gamma = await createQuote(db, s.organization, {
      owner: s.members.member.user,
      account: globex,
      name: "gamma pilot",
      status: "rejected",
      createdAt: new Date("2026-03-10T12:00:00Z"),
    })
    return { ...s, initech, globex, alpha, beta, gamma }
  }

  const names = (result: { rows: { name: string }[] }) =>
    result.rows.map((r) => r.name)

  it("lists every member's Quotes, newest first, with Account and Owner", () =>
    withTestDb(async (db) => {
      const { caller, members, alpha, initech } = await listSetup(db)
      const result = await caller("otherMember").quote.list({})
      expect(names(result)).toEqual([
        "gamma pilot",
        "Beta support",
        "Alpha rollout",
      ])
      expect(result.total).toBe(3)
      expect(result.rows[2]).toMatchObject({
        id: alpha.id,
        account: { id: initech.id, name: "Initech" },
        owner: { id: members.member.user.id },
        status: "draft",
        currencyCode: "USD",
        total: "0.0000",
      })
    }))

  it("flags a Valid Until in the past", () =>
    withTestDb(async (db) => {
      const { caller } = await listSetup(db)
      const { rows } = await caller("member").quote.list({})
      expect(
        Object.fromEntries(rows.map((r) => [r.name, r.validUntilPassed]))
      ).toEqual({
        "Alpha rollout": true,
        "Beta support": false,
        "gamma pilot": false,
      })
    }))

  it("searches Name, Description and Account name", () =>
    withTestDb(async (db) => {
      const { caller } = await listSetup(db)
      const search = async (term: string) =>
        names(await caller("member").quote.list({ search: term }))
      expect(await search("PILOT")).toEqual(["gamma pilot"])
      expect(await search("robots")).toEqual(["Alpha rollout"])
      expect(await search("globex")).toEqual(["gamma pilot", "Beta support"])
      expect(await search("100%")).toEqual([])
    }))

  it("filters by statuses, Account, created date range and owner", () =>
    withTestDb(async (db) => {
      const { caller, globex } = await listSetup(db)
      const list = async (
        input: Parameters<ReturnType<typeof caller>["quote"]["list"]>[0]
      ) => names(await caller("member").quote.list(input))
      expect(await list({ statuses: ["draft", "rejected"] })).toEqual([
        "gamma pilot",
        "Alpha rollout",
      ])
      expect(await list({ accountId: globex.id })).toEqual([
        "gamma pilot",
        "Beta support",
      ])
      expect(
        await list({ createdFrom: "2026-02-10", createdTo: "2026-03-09" })
      ).toEqual(["Beta support"])
      expect(await list({ createdTo: "2026-01-10" })).toEqual(["Alpha rollout"])
      expect(await list({ owner: "mine" })).toEqual([
        "gamma pilot",
        "Alpha rollout",
      ])
      expect(
        await list({ owner: "mine", statuses: ["rejected"], search: "gam" })
      ).toEqual(["gamma pilot"])
    }))

  it("rejects a created range that ends before it starts", () =>
    withTestDb(async (db) => {
      const { caller } = await listSetup(db)
      await expect(
        caller("member").quote.list({
          createdFrom: "2026-03-01",
          createdTo: "2026-02-01",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))

  it("sorts by any column, both ways", () =>
    withTestDb(async (db) => {
      const { caller } = await listSetup(db)
      const sorted = async (
        by: "name" | "account" | "status" | "validUntil" | "createdAt",
        direction: "asc" | "desc"
      ) => names(await caller("member").quote.list({ sort: { by, direction } }))
      // Case-insensitive by Name.
      expect(await sorted("name", "asc")).toEqual([
        "Alpha rollout",
        "Beta support",
        "gamma pilot",
      ])
      expect(await sorted("name", "desc")).toEqual([
        "gamma pilot",
        "Beta support",
        "Alpha rollout",
      ])
      expect((await sorted("account", "asc"))[2]).toBe("Alpha rollout")
      expect(await sorted("createdAt", "asc")).toEqual([
        "Alpha rollout",
        "Beta support",
        "gamma pilot",
      ])
      // Quotes without Valid Until come last either way.
      expect(await sorted("validUntil", "asc")).toEqual([
        "Alpha rollout",
        "Beta support",
        "gamma pilot",
      ])
      expect(await sorted("validUntil", "desc")).toEqual([
        "Beta support",
        "Alpha rollout",
        "gamma pilot",
      ])
    }))

  it("pages on the server", () =>
    withTestDb(async (db) => {
      const { caller } = await listSetup(db)
      const page = (n: number) =>
        caller("member").quote.list({
          page: n,
          pageSize: 2,
          sort: { by: "name", direction: "asc" },
        })
      expect(await page(1)).toMatchObject({ total: 3, page: 1, pageSize: 2 })
      expect(names(await page(1))).toEqual(["Alpha rollout", "Beta support"])
      expect(names(await page(2))).toEqual(["gamma pilot"])
      expect(names(await page(3))).toEqual([])
    }))

  it("shows only this Organization's Quotes, and refuses non-members", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await listSetup(db)
      const globex = await createOrganization(db)
      const { user: outsider } = await createMember(db, globex)
      await createQuote(db, globex, { owner: outsider, name: "Theirs" })
      expect(names(await caller("member").quote.list({}))).not.toContain(
        "Theirs"
      )
      await expect(
        organizationCaller(db, { organization, user: outsider }).quote.list({})
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      // Filtering by another Organization's Account finds nothing.
      const theirAccount = await createAccount(db, globex)
      expect(
        (await caller("member").quote.list({ accountId: theirAccount.id }))
          .total
      ).toBe(0)
    }))

  it("offers the Accounts that have Quotes as filter options", () =>
    withTestDb(async (db) => {
      const { organization, caller, initech, globex } = await listSetup(db)
      await createAccount(db, organization, { name: "Unquoted" })
      expect(await caller("member").quote.filterOptions()).toEqual({
        accounts: [
          { id: globex.id, name: "Globex" },
          { id: initech.id, name: "Initech" },
        ],
      })
    }))
})

describe("quote.byId", () => {
  it("returns the header, Account, Owner and the viewer's permissions", () =>
    withTestDb(async (db) => {
      const { organization, members, caller } = await setup(db)
      const account = await createAccount(db, organization, { name: "Initech" })
      const quote = await createQuote(db, organization, {
        owner: members.member.user,
        account,
        name: "Pilot",
        description: "First phase",
      })
      const own = await caller("member").quote.byId({ id: quote.id })
      expect(own).toMatchObject({
        id: quote.id,
        name: "Pilot",
        description: "First phase",
        status: "draft",
        locked: false,
        account: { id: account.id, name: "Initech", archived: false },
        owner: {
          id: members.member.user.id,
          email: members.member.user.email,
          isMember: true,
        },
        updatedBy: { id: members.member.user.id },
        permissions: {
          canEdit: true,
          canDelete: true,
          canSubmit: false, // Total is zero
          canApprove: false,
          editDenial: null,
        },
      })
      const colleague = await caller("otherMember").quote.byId({
        id: quote.id,
      })
      expect(colleague.permissions).toMatchObject({
        canEdit: false,
        canDelete: false,
        editDenial: { reason: "not_allowed_to_edit" },
      })
    }))

  it("marks a locked Quote read-only for everyone", () =>
    withTestDb(async (db) => {
      const { organization, members, caller } = await setup(db)
      const quote = await createQuote(db, organization, {
        owner: members.member.user,
        status: "pending_approval",
      })
      const view = await caller("admin").quote.byId({ id: quote.id })
      expect(view.locked).toBe(true)
      expect(view.permissions).toMatchObject({
        canEdit: false,
        canRecall: true,
        editDenial: { reason: "locked" },
      })
    }))

  it("is NOT_FOUND for an unknown id, and isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization, members, caller } = await setup(db)
      await expect(
        caller("member").quote.byId({
          id: "00000000-0000-7000-8000-000000000000",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      const quote = await createQuote(db, organization, {
        owner: members.member.user,
      })
      await expectIsolated(db, {
        owner: organization,
        call: (c) => c.quote.byId({ id: quote.id }),
      })
    }))
})

describe("quote.rename and quote.setDescription", () => {
  it("rename changes only the Name and records who changed it", () =>
    withTestDb(async (db) => {
      const { organization, members, caller } = await setup(db)
      const quote = await createQuote(db, organization, {
        owner: members.member.user,
        name: "Pilot",
        description: "Keep me",
      })
      const result = await caller("manager").quote.rename({
        id: quote.id,
        name: "  Pilot v2 ",
      })
      expect(result).toMatchObject({
        id: quote.id,
        name: "Pilot v2",
        updatedById: members.manager.user.id,
      })
      const [row] = await snapshotQuote(db, quote.id)()
      expect(row).toMatchObject({
        name: "Pilot v2",
        description: "Keep me",
        ownerId: members.member.user.id,
        updatedById: members.manager.user.id,
      })
    }))

  it("setDescription changes only the Description; blank clears it", () =>
    withTestDb(async (db) => {
      const { organization, members, caller } = await setup(db)
      const quote = await createQuote(db, organization, {
        owner: members.member.user,
        name: "Pilot",
      })
      expect(
        await caller("member").quote.setDescription({
          id: quote.id,
          description: " Scope: phase one ",
        })
      ).toMatchObject({ description: "Scope: phase one" })
      expect(
        await caller("member").quote.setDescription({
          id: quote.id,
          description: "  ",
        })
      ).toMatchObject({ description: null })
      const [row] = await snapshotQuote(db, quote.id)()
      expect(row).toMatchObject({ name: "Pilot", description: null })
    }))

  it("rejects a blank Name", () =>
    withTestDb(async (db) => {
      const { organization, members, caller } = await setup(db)
      const quote = await createQuote(db, organization, {
        owner: members.member.user,
      })
      await expect(
        caller("member").quote.rename({ id: quote.id, name: "   " })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))

  // Owner's Role → who may edit (Admin any; Manager own + Members'; Member own).
  const EDIT_RULES: [
    string,
    "admin" | "manager" | "member",
    ("admin" | "manager" | "member" | "otherMember" | "otherManager")[],
  ][] = [
    [
      "a Member's Quote",
      "member",
      ["admin", "manager", "member", "otherManager"],
    ],
    ["a Manager's Quote", "manager", ["admin", "manager"]],
    ["an Admin's Quote", "admin", ["admin"]],
  ]
  it.each(EDIT_RULES)("edit permission on %s", (_label, ownerKey, allowed) =>
    withTestDb(async (db) => {
      const { organization, members, caller } = await setup(db)
      const quote = await createQuote(db, organization, {
        owner: members[ownerKey].user,
      })
      for (const who of Object.keys(members) as (keyof typeof members)[]) {
        const attempt = caller(who).quote.rename({ id: quote.id, name: who })
        if (allowed.includes(who)) {
          await expect(attempt, who).resolves.toMatchObject({ name: who })
        } else {
          await expect(attempt, who).rejects.toMatchObject({
            code: "FORBIDDEN",
          })
          await expect(
            caller(who).quote.setDescription({
              id: quote.id,
              description: who,
            }),
            who
          ).rejects.toMatchObject({ code: "FORBIDDEN" })
        }
      }
    })
  )

  it("a removed member's Quotes can be edited only by Admins", () =>
    withTestDb(async (db) => {
      const { organization, members, caller } = await setup(db)
      const quote = await createQuote(db, organization, {
        owner: members.member.user,
      })
      await db
        .delete(memberships)
        .where(eq(memberships.id, members.member.membership.id))
      await expect(
        caller("manager").quote.rename({ id: quote.id, name: "Manager" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
      await expect(
        caller("admin").quote.rename({ id: quote.id, name: "Admin" })
      ).resolves.toMatchObject({ name: "Admin" })
      const view = await caller("admin").quote.byId({ id: quote.id })
      expect(view.owner).toMatchObject({
        id: members.member.user.id,
        isMember: false,
      })
    }))

  it.each(LOCKED_STATUSES)(
    "refuses edits while %s, even for Admins",
    (status: QuoteStatus) =>
      withTestDb(async (db) => {
        const { organization, members, caller } = await setup(db)
        const quote = await createQuote(db, organization, {
          owner: members.admin.user,
          status,
          name: "Locked",
        })
        await expect(
          caller("admin").quote.rename({ id: quote.id, name: "Changed" })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
        await expect(
          caller("admin").quote.setDescription({
            id: quote.id,
            description: "Changed",
          })
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
        const [row] = await snapshotQuote(db, quote.id)()
        expect(row).toMatchObject({ name: "Locked", description: null })
      })
  )

  it.each<QuoteStatus>(["draft", "rejected", "customer_rejected"])(
    "allows edits while %s",
    (status) =>
      withTestDb(async (db) => {
        const { organization, members, caller } = await setup(db)
        const quote = await createQuote(db, organization, {
          owner: members.member.user,
          status,
        })
        await expect(
          caller("member").quote.rename({ id: quote.id, name: "Open" })
        ).resolves.toMatchObject({ name: "Open" })
      })
  )

  it("is NOT_FOUND for an unknown id", () =>
    withTestDb(async (db) => {
      const { caller } = await setup(db)
      await expect(
        caller("admin").quote.rename({
          id: "00000000-0000-7000-8000-000000000000",
          name: "x",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))

  it.each(["rename", "setDescription"] as const)(
    "%s is isolated from other Organizations",
    (command) =>
      withTestDb(async (db) => {
        const acme = await createOrganization(db)
        const owner = await createUser(db)
        await db.insert(memberships).values({
          organizationId: acme.id,
          userId: owner.id,
          role: "member" satisfies Role,
        })
        const quote = await createQuote(db, acme, { owner })
        await expectIsolated(db, {
          owner: acme,
          call: (caller) =>
            command === "rename"
              ? caller.quote.rename({ id: quote.id, name: "Hacked" })
              : caller.quote.setDescription({
                  id: quote.id,
                  description: "Hacked",
                }),
          snapshot: snapshotQuote(db, quote.id),
        })
      })
  )
})
