import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import { LOCKED_STAGES } from "@workspace/domain/stages"
import type { QuoteStage, Role } from "@workspace/domain/enums"

import {
  createApprovalStep,
  createCustomer,
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

const newQuote = (customerId: string) => ({
  customerId,
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
      const customer = await createCustomer(db, organization)
      const created = await caller("member").quote.create({
        ...newQuote(customer.id),
        name: "  Pilot  ",
        description: " Phase one ",
      })
      const [row] = await snapshotQuote(db, created.id)()
      expect(row).toMatchObject({
        id: created.id,
        name: "Pilot",
        description: "Phase one",
        customerId: customer.id,
        stage: "draft",
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
      const customer = await createCustomer(db, organization)
      await caller("member").quote.create(newQuote(customer.id))
      await expect(
        caller("member").quote.create(newQuote(customer.id))
      ).resolves.toMatchObject({ name: "Pilot" })
    }))

  it("rejects an end date before the start date, and malformed dates", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const customer = await createCustomer(db, organization)
      for (const dates of [
        { startDate: "2026-10-02", endDate: "2026-10-01" },
        { startDate: "2026-02-30", endDate: "2026-10-01" },
        { startDate: "10/01/2026", endDate: "2026-10-01" },
      ]) {
        await expect(
          caller("member").quote.create({ ...newQuote(customer.id), ...dates }),
          JSON.stringify(dates)
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
    }))

  it("allows a one-day Quote and no Valid Until", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const customer = await createCustomer(db, organization)
      const { id } = await caller("member").quote.create({
        ...newQuote(customer.id),
        endDate: "2026-10-01",
        validUntil: null,
      })
      const [row] = await snapshotQuote(db, id)()
      expect(row).toMatchObject({ endDate: "2026-10-01", validUntil: null })
    }))

  it("refuses an archived Customer", () =>
    withTestDb(async (db) => {
      const { organization, caller } = await setup(db)
      const customer = await createCustomer(db, organization, {
        archived: true,
      })
      await expect(
        caller("member").quote.create(newQuote(customer.id))
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    }))

  it("is isolated from other Organizations' Customers", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const customer = await createCustomer(db, acme)
      await expectIsolated(db, {
        owner: acme,
        call: (caller) => caller.quote.create(newQuote(customer.id)),
        snapshot: () =>
          db.select().from(quotes).where(eq(quotes.customerId, customer.id)),
      })
    }))
})

describe("quote.nameTaken", () => {
  it("warns when the Customer has a Quote with that Name, ignoring case and spaces", () =>
    withTestDb(async (db) => {
      const { organization, members, caller } = await setup(db)
      const customer = await createCustomer(db, organization)
      const other = await createCustomer(db, organization)
      const quote = await createQuote(db, organization, {
        owner: members.admin.user,
        customer,
        name: "Pilot",
      })
      const taken = (input: {
        customerId: string
        name: string
        exceptId?: string
      }) => caller("member").quote.nameTaken(input)
      expect(await taken({ customerId: customer.id, name: " pilot " })).toEqual(
        {
          taken: true,
          count: 1,
        }
      )
      expect(await taken({ customerId: customer.id, name: "Pilot 2" })).toEqual(
        {
          taken: false,
          count: 0,
        }
      )
      expect(await taken({ customerId: other.id, name: "Pilot" })).toEqual({
        taken: false,
        count: 0,
      })
      expect(
        await taken({
          customerId: customer.id,
          name: "Pilot",
          exceptId: quote.id,
        })
      ).toEqual({ taken: false, count: 0 })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme)
      const customer = await createCustomer(db, acme)
      await createQuote(db, acme, { owner: user, customer, name: "Secret" })
      await expectIsolated(db, {
        owner: acme,
        call: (caller) =>
          caller.quote.nameTaken({ customerId: customer.id, name: "Secret" }),
      })
    }))
})

describe("quote.list", () => {
  /**
   * Three Quotes with distinct names, Customers, owners, Stages and dates;
   * gamma is a Draft an Approver rejected.
   */
  async function listSetup(db: Db) {
    const s = await setup(db)
    const initech = await createCustomer(db, s.organization, {
      name: "Initech",
    })
    const globex = await createCustomer(db, s.organization, { name: "Globex" })
    const alpha = await createQuote(db, s.organization, {
      owner: s.members.member.user,
      customer: initech,
      name: "Alpha rollout",
      description: "Warehouse robots",
      stage: "draft",
      validUntil: "2000-01-01",
      createdAt: new Date("2026-01-10T12:00:00Z"),
    })
    const beta = await createQuote(db, s.organization, {
      owner: s.members.manager.user,
      customer: globex,
      name: "Beta support",
      stage: "approved",
      validUntil: "2999-01-01",
      createdAt: new Date("2026-02-10T12:00:00Z"),
    })
    const gamma = await createQuote(db, s.organization, {
      owner: s.members.member.user,
      customer: globex,
      name: "gamma pilot",
      createdAt: new Date("2026-03-10T12:00:00Z"),
    })
    await createApprovalStep(db, gamma, {
      action: "submit",
      actor: s.members.member.user,
      createdAt: new Date("2026-03-11T12:00:00Z"),
    })
    await createApprovalStep(db, gamma, {
      action: "reject",
      actor: s.members.admin.user,
      createdAt: new Date("2026-03-12T12:00:00Z"),
    })
    return { ...s, initech, globex, alpha, beta, gamma }
  }

  const names = (result: { rows: { name: string }[] }) =>
    result.rows.map((r) => r.name)

  it("lists every member's Quotes, newest first, with Customer and Owner", () =>
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
        customer: { id: initech.id, name: "Initech" },
        owner: { id: members.member.user.id },
        stage: "draft",
        status: { name: "Draft", colour: null },
        rejected: false,
        currencyCode: "USD",
        total: "0.0000",
      })
      expect(result.rows[0]).toMatchObject({
        name: "gamma pilot",
        stage: "draft",
        status: { name: "Draft" },
        rejected: true,
      })
      expect(result.rows[1]).toMatchObject({
        stage: "approved",
        status: { name: "Approved" },
        rejected: false,
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

  it("searches Name, Description and Customer name", () =>
    withTestDb(async (db) => {
      const { caller } = await listSetup(db)
      const search = async (term: string) =>
        names(await caller("member").quote.list({ search: term }))
      expect(await search("PILOT")).toEqual(["gamma pilot"])
      expect(await search("robots")).toEqual(["Alpha rollout"])
      expect(await search("globex")).toEqual(["gamma pilot", "Beta support"])
      expect(await search("100%")).toEqual([])
    }))

  it("filters by Stages, Customer, created date range and owner", () =>
    withTestDb(async (db) => {
      const { caller, globex } = await listSetup(db)
      const list = async (
        input: Parameters<ReturnType<typeof caller>["quote"]["list"]>[0]
      ) => names(await caller("member").quote.list(input))
      expect(await list({ stages: ["draft"] })).toEqual([
        "gamma pilot",
        "Alpha rollout",
      ])
      expect(await list({ customerId: globex.id })).toEqual([
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
        await list({ owner: "mine", rejected: true, search: "gam" })
      ).toEqual(["gamma pilot"])
    }))

  it("filters by a Valid Until range", () =>
    withTestDb(async (db) => {
      const { caller } = await listSetup(db)
      const list = async (validUntilFrom?: string, validUntilTo?: string) =>
        names(
          await caller("member").quote.list({ validUntilFrom, validUntilTo })
        )
      expect(await list("2000-01-01", "2000-01-01")).toEqual(["Alpha rollout"])
      expect(await list("2001-01-01")).toEqual(["Beta support"])
      expect(await list(undefined, "2998-12-31")).toEqual(["Alpha rollout"])
    }))

  it("filters by Quote Status, grouped as the Status filter offers them", () =>
    withTestDb(async (db) => {
      const { caller } = await listSetup(db)
      const statuses = await caller("member").quoteStatus.list()
      const id = (name: string) => statuses.find((s) => s.name === name)!.id
      const list = async (statusIds: string[]) =>
        names(await caller("member").quote.list({ statusIds }))
      expect(await list([id("Approved")])).toEqual(["Beta support"])
      expect(await list([id("Draft"), id("Approved")])).toEqual([
        "gamma pilot",
        "Beta support",
        "Alpha rollout",
      ])
      expect(await list([id("Sent")])).toEqual([])
    }))

  it("filters Rejected Quotes in or out", () =>
    withTestDb(async (db) => {
      const { caller } = await listSetup(db)
      const list = async (rejected: boolean) =>
        names(await caller("member").quote.list({ rejected }))
      expect(await list(true)).toEqual(["gamma pilot"])
      expect(await list(false)).toEqual(["Beta support", "Alpha rollout"])
    }))

  it("ends Rejected at the next Submission", () =>
    withTestDb(async (db) => {
      const { caller, gamma } = await listSetup(db)
      await db
        .update(quotes)
        .set({ total: "100" })
        .where(eq(quotes.id, gamma.id))
      expect(
        (await caller("member").quote.byId({ id: gamma.id })).rejected
      ).toBe(true)
      await caller("member").quote.submit({ id: gamma.id })
      await caller("admin").quote.recall({ id: gamma.id })
      expect(await caller("member").quote.byId({ id: gamma.id })).toMatchObject(
        { stage: "draft", rejected: false }
      )
    }))

  it("counts every Stage under the other filters", () =>
    withTestDb(async (db) => {
      const { caller, globex } = await listSetup(db)
      const all = await caller("member").quote.list({ stages: ["draft"] })
      expect(all.total).toBe(2)
      expect(all.stageCounts).toEqual({
        draft: 2,
        in_approval: 0,
        approved: 1,
        with_customer: 0,
        won: 0,
        lost: 0,
      })
      const onGlobex = await caller("member").quote.list({
        customerId: globex.id,
        stages: ["approved"],
      })
      expect(onGlobex.total).toBe(1)
      expect(onGlobex.stageCounts).toMatchObject({ draft: 1, approved: 1 })
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
        by: "name" | "customer" | "status" | "validUntil" | "createdAt",
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
      expect((await sorted("customer", "asc"))[2]).toBe("Alpha rollout")
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
      // Filtering by another Organization's Customer finds nothing.
      const theirCustomer = await createCustomer(db, globex)
      expect(
        (await caller("member").quote.list({ customerId: theirCustomer.id }))
          .total
      ).toBe(0)
    }))

  it("offers the Customers that have Quotes as filter options", () =>
    withTestDb(async (db) => {
      const { organization, caller, initech, globex } = await listSetup(db)
      await createCustomer(db, organization, { name: "Unquoted" })
      expect(await caller("member").quote.filterOptions()).toEqual({
        customers: [
          { id: globex.id, name: "Globex" },
          { id: initech.id, name: "Initech" },
        ],
      })
    }))
})

describe("quote.byId", () => {
  it("returns the header, Customer, Owner and the viewer's permissions", () =>
    withTestDb(async (db) => {
      const { organization, members, caller } = await setup(db)
      const customer = await createCustomer(db, organization, {
        name: "Initech",
      })
      const quote = await createQuote(db, organization, {
        owner: members.member.user,
        customer,
        name: "Pilot",
        description: "First phase",
      })
      const own = await caller("member").quote.byId({ id: quote.id })
      expect(own).toMatchObject({
        id: quote.id,
        name: "Pilot",
        description: "First phase",
        stage: "draft",
        status: { name: "Draft", colour: null },
        rejected: false,
        locked: false,
        customer: { id: customer.id, name: "Initech", archived: false },
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
        stage: "in_approval",
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

  it.each(LOCKED_STAGES)(
    "refuses edits while %s, even for Admins",
    (stage: QuoteStage) =>
      withTestDb(async (db) => {
        const { organization, members, caller } = await setup(db)
        const quote = await createQuote(db, organization, {
          owner: members.admin.user,
          stage,
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

  it.each([null, "reject", "customer_rejected"] as const)(
    "allows edits in Draft (latest step: %s)",
    (action) =>
      withTestDb(async (db) => {
        const { organization, members, caller } = await setup(db)
        const quote = await createQuote(db, organization, {
          owner: members.member.user,
        })
        if (action) {
          await createApprovalStep(db, quote, {
            action,
            actor: members.admin.user,
          })
        }
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
