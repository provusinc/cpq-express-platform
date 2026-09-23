import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"

import {
  createCatalogItem,
  createMember,
  createOrganization,
  createUser,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const { catalogItems } = schema

async function setup(db: Db) {
  const organization = await createOrganization(db)
  const admin = await createMember(db, organization, { role: "admin" })
  const manager = await createMember(db, organization, { role: "manager" })
  const member = await createMember(db, organization, {
    role: "member",
    isApprover: true,
  })
  const as = (who: { user: { id: string } } & typeof admin) =>
    organizationCaller(db, { organization, user: who.user })
  return {
    organization,
    admin: as(admin),
    manager: as(manager),
    member: as(member),
  }
}

const snapshotItem = (db: Db, id: string) => () =>
  db.select().from(catalogItems).where(eq(catalogItems.id, id))

describe("catalogItem.create", () => {
  it("creates a Product with money at storage scale and normalised tags", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      const item = await admin.catalogItem.create({
        kind: "product",
        name: " Premium Support Plan ",
        description: "24/7",
        price: "250",
        cost: "180.5",
        tags: [" Support", "premium", "support", ""],
      })
      expect(item).toMatchObject({
        organizationId: organization.id,
        kind: "product",
        name: "Premium Support Plan",
        price: "250.0000",
        cost: "180.5000",
        billingUnit: "each",
        tags: ["support", "premium"],
        active: true,
      })
    }))

  it("creates an hourly Add-on", () =>
    withTestDb(async (db) => {
      const { admin } = await setup(db)
      expect(
        await admin.catalogItem.create({
          kind: "add_on",
          name: "Project Management",
          price: "125.00",
          cost: "100",
          billingUnit: "hour",
        })
      ).toMatchObject({ kind: "add_on", billingUnit: "hour" })
    }))

  it("refuses an hourly Product, in the API and the database", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      await expect(
        admin.catalogItem.create({
          kind: "product",
          name: "Hourly thing",
          price: "1",
          cost: "1",
          billingUnit: "hour",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      await expect(
        db.transaction((tx) =>
          createCatalogItem(tx, organization, { billingUnit: "hour" })
        )
      ).rejects.toMatchObject({
        cause: { constraint_name: "catalog_items_product_billed_each" },
      })
    }))

  it.each([["-1"], ["abc"], ["1.23456"], ["1e3"], [""]])(
    "rejects the price %j",
    (price) =>
      withTestDb(async (db) => {
        const { admin } = await setup(db)
        await expect(
          admin.catalogItem.create({
            kind: "add_on",
            name: "X",
            price,
            cost: "1",
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      })
  )

  it("is for Admins only", () =>
    withTestDb(async (db) => {
      const { manager, member } = await setup(db)
      for (const caller of [manager, member]) {
        await expect(
          caller.catalogItem.create({
            kind: "product",
            name: "X",
            price: "1",
            cost: "1",
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" })
      }
    }))

  it("refuses a non-member", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const outsider = organizationCaller(db, {
        organization,
        user: await createUser(db),
      })
      await expect(
        outsider.catalogItem.create({
          kind: "product",
          name: "X",
          price: "1",
          cost: "1",
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})

describe("catalogItem.list", () => {
  it("lists one kind, filtered and paged, for any member", () =>
    withTestDb(async (db) => {
      const { organization, member } = await setup(db)
      await createCatalogItem(db, organization, {
        name: "Basic Support",
        price: "75",
        tags: ["support", "basic"],
      })
      await createCatalogItem(db, organization, {
        name: "Premium Support",
        price: "250",
        tags: ["support", "premium"],
      })
      await createCatalogItem(db, organization, {
        name: "Old Workshop",
        price: "185",
        active: false,
      })
      await createCatalogItem(db, organization, {
        kind: "add_on",
        name: "Project Management",
        billingUnit: "hour",
      })
      await createCatalogItem(db, await createOrganization(db), {
        name: "Elsewhere",
      })
      const names = async (
        input: Partial<Parameters<typeof member.catalogItem.list>[0]>
      ) =>
        (await member.catalogItem.list({ kind: "product", ...input })).rows.map(
          (r) => r.name
        )

      expect(await names({})).toEqual([
        "Basic Support",
        "Old Workshop",
        "Premium Support",
      ])
      expect(await names({ status: "active" })).toEqual([
        "Basic Support",
        "Premium Support",
      ])
      expect(await names({ status: "inactive" })).toEqual(["Old Workshop"])
      expect(await names({ minPrice: "75.0001", maxPrice: "250" })).toEqual([
        "Old Workshop",
        "Premium Support",
      ])
      expect(await names({ tags: ["Support", "premium"] })).toEqual([
        "Premium Support",
      ])
      expect(await names({ search: "work" })).toEqual(["Old Workshop"])
      expect(await names({ pageSize: 2, page: 2 })).toEqual(["Premium Support"])
      expect(
        (
          await member.catalogItem.list({ kind: "add_on", billingUnit: "hour" })
        ).rows.map((r) => r.name)
      ).toEqual(["Project Management"])
      expect((await member.catalogItem.list({ kind: "product" })).total).toBe(3)
    }))
})

describe("catalogItem.tags", () => {
  it("lists the tags in use on one kind", () =>
    withTestDb(async (db) => {
      const { organization, member } = await setup(db)
      await createCatalogItem(db, organization, { tags: ["support", "basic"] })
      await createCatalogItem(db, organization, { tags: ["support"] })
      await createCatalogItem(db, organization, {
        kind: "add_on",
        tags: ["addon-only"],
      })
      expect(await member.catalogItem.tags({ kind: "product" })).toEqual([
        "basic",
        "support",
      ])
    }))
})

describe("catalogItem.byId", () => {
  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const item = await createCatalogItem(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.catalogItem.byId({ id: item.id }),
      })
    }))
})

describe("catalogItem.update", () => {
  it("changes only the given fields", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      const item = await createCatalogItem(db, organization, {
        kind: "add_on",
        name: "Code Review",
        description: "Extra review",
        tags: ["review"],
      })
      expect(
        await admin.catalogItem.update({
          id: item.id,
          price: "55.5",
          billingUnit: "hour",
          description: "",
        })
      ).toMatchObject({
        name: "Code Review",
        price: "55.5000",
        cost: "60.0000",
        billingUnit: "hour",
        description: null,
        tags: ["review"],
      })
    }))

  it("keeps Products billed Each", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      const item = await createCatalogItem(db, organization)
      await expect(
        admin.catalogItem.update({ id: item.id, billingUnit: "hour" })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))

  it("is for Admins only", () =>
    withTestDb(async (db) => {
      const { organization, manager } = await setup(db)
      const item = await createCatalogItem(db, organization)
      await expect(
        manager.catalogItem.update({ id: item.id, name: "Nope" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
      expect(await snapshotItem(db, item.id)()).toMatchObject([
        { name: item.name },
      ])
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const item = await createCatalogItem(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) =>
          caller.catalogItem.update({ id: item.id, price: "0" }),
        snapshot: snapshotItem(db, item.id),
      })
    }))
})

describe("catalogItem.deactivate / reactivate", () => {
  it("toggles whether the item is active", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      const item = await createCatalogItem(db, organization)
      expect(await admin.catalogItem.deactivate({ id: item.id })).toMatchObject(
        { active: false }
      )
      expect(await admin.catalogItem.reactivate({ id: item.id })).toMatchObject(
        { active: true }
      )
    }))

  it("is for Admins only", () =>
    withTestDb(async (db) => {
      const { organization, member } = await setup(db)
      const item = await createCatalogItem(db, organization)
      await expect(
        member.catalogItem.deactivate({ id: item.id })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const item = await createCatalogItem(db, organization)
      const inactive = await createCatalogItem(db, organization, {
        active: false,
      })
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.catalogItem.deactivate({ id: item.id }),
        snapshot: snapshotItem(db, item.id),
      })
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.catalogItem.reactivate({ id: inactive.id }),
        snapshot: snapshotItem(db, inactive.id),
      })
    }))
})

describe("catalogItem.delete", () => {
  it("deletes an unused item", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      const item = await createCatalogItem(db, organization)
      await admin.catalogItem.delete({ id: item.id })
      expect(await snapshotItem(db, item.id)()).toEqual([])
    }))

  it("is for Admins only", () =>
    withTestDb(async (db) => {
      const { organization, manager } = await setup(db)
      const item = await createCatalogItem(db, organization)
      await expect(
        manager.catalogItem.delete({ id: item.id })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
      expect(await snapshotItem(db, item.id)()).toHaveLength(1)
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const item = await createCatalogItem(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.catalogItem.delete({ id: item.id }),
        snapshot: snapshotItem(db, item.id),
      })
    }))
})
