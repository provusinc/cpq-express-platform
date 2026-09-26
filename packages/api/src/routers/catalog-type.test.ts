import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import { MAX_ACTIVE_CATALOG_TYPES } from "@workspace/domain/catalog"

import { inUseDetails } from "../errors"
import {
  catalogTypeNamed,
  createCatalogItem,
  createMember,
  createOrganization,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

describe("catalogType.list", () => {
  it("gives a new Organization Product and Add-on, for any member", () =>
    withTestDb(async (db) => {
      const organization = await createOrganization(db)
      const { user } = await createMember(db, organization, { role: "member" })
      const caller = organizationCaller(db, { organization, user })
      expect(
        (await caller.catalogType.list()).map((t) => ({
          singular: t.singular,
          plural: t.plural,
          billingUnits: t.billingUnits,
          colourIndex: t.colourIndex,
          active: t.active,
        }))
      ).toEqual([
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
    }))

  it("refuses a non-member on the Organization's subdomain", () =>
    withTestDb(async (db) => {
      const organization = await createOrganization(db)
      const outsider = await createOrganization(db)
      const { user } = await createMember(db, outsider, { role: "admin" })
      await expect(
        organizationCaller(db, { organization, user }).catalogType.list()
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
    }))
})

describe("catalogType.byId", () => {
  it("reads one type", () =>
    withTestDb(async (db) => {
      const organization = await createOrganization(db)
      const { user } = await createMember(db, organization)
      const product = await catalogTypeNamed(db, organization, "Product")
      expect(
        await organizationCaller(db, { organization, user }).catalogType.byId({
          id: product.id,
        })
      ).toMatchObject({ id: product.id, singular: "Product" })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const organization = await createOrganization(db)
      const product = await catalogTypeNamed(db, organization, "Product")
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.catalogType.byId({ id: product.id }),
      })
    }))
})

/** An Organization with an Admin, and that Admin's caller. */
async function adminOf(db: Db) {
  const acme = await createOrganization(db)
  const { user } = await createMember(db, acme, { role: "admin" })
  return { acme, caller: organizationCaller(db, { organization: acme, user }) }
}

const service = {
  singular: "Service",
  plural: "Services",
  billingUnits: ["hour"] as ("each" | "hour")[],
}

describe("catalogType.list counts", () => {
  it("counts each type's Catalog Items, per Billing Unit", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await adminOf(db)
      await createCatalogItem(db, acme, { type: "Add-on", billingUnit: "hour" })
      await createCatalogItem(db, acme, { type: "Add-on", active: false })
      const [product, addOn] = await caller.catalogType.list()
      expect(product).toMatchObject({
        itemCount: 0,
        itemsByUnit: { each: 0, hour: 0 },
      })
      expect(addOn).toMatchObject({
        itemCount: 2,
        itemsByUnit: { each: 1, hour: 1 },
      })
    }))
})

describe("catalogType.create", () => {
  it("adds a type at the end, trimmed, on the first free colour", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const created = await caller.catalogType.create({
        singular: "  Service ",
        plural: "Services",
        billingUnits: ["hour", "each"],
      })
      expect(created).toMatchObject({
        singular: "Service",
        plural: "Services",
        billingUnits: ["each", "hour"],
        colourIndex: 2,
        active: true,
        sequence: 2,
        itemCount: 0,
      })
      expect((await caller.catalogType.list()).map((t) => t.singular)).toEqual([
        "Product",
        "Add-on",
        "Service",
      ])
    }))

  it(`allows at most ${MAX_ACTIVE_CATALOG_TYPES} active types`, () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      for (let i = 2; i < MAX_ACTIVE_CATALOG_TYPES; i++) {
        await caller.catalogType.create({
          singular: `Type ${i}`,
          plural: `Types ${i}`,
          billingUnits: ["each"],
        })
      }
      await expect(
        caller.catalogType.create({ ...service })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining(`At most ${MAX_ACTIVE_CATALOG_TYPES}`),
      })
      // An inactive one is fine, and can't be activated while the cap holds.
      const extra = await caller.catalogType.create({
        ...service,
        active: false,
      })
      await expect(
        caller.catalogType.update({ id: extra.id, active: true })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    }))

  it("refuses a name another type has, ignoring case, singular or plural", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      await expect(
        caller.catalogType.create({ ...service, singular: " product " })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "A Catalog Type named “product” already exists.",
      })
      await expect(
        caller.catalogType.create({ ...service, plural: "ADD-ONS" })
      ).rejects.toMatchObject({ code: "CONFLICT" })
    }))

  it("refuses no Billing Unit, blank names and a taken colour", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      await expect(
        caller.catalogType.create({ ...service, billingUnits: [] })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Pick at least one Billing Unit.",
      })
      await expect(
        caller.catalogType.create({ ...service, plural: "  " })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      await expect(
        caller.catalogType.create({ ...service, colourIndex: 0 })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Products already use this colour. Pick another.",
      })
    }))

  it("is for Admins only", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme, { role: "manager" })
      await expect(
        organizationCaller(db, { organization: acme, user }).catalogType.create(
          { ...service }
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    }))
})

describe("catalogType.update", () => {
  it("renames, recolours and deactivates a type", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await adminOf(db)
      const product = await catalogTypeNamed(db, acme, "Product")
      expect(
        await caller.catalogType.update({
          id: product.id,
          singular: "Licence",
          plural: "Licences",
          colourIndex: 4,
          active: false,
        })
      ).toMatchObject({
        singular: "Licence",
        plural: "Licences",
        colourIndex: 4,
        active: false,
        billingUnits: ["each"],
      })
      // Its own names are not a clash.
      await caller.catalogType.update({ id: product.id, singular: "licence" })
    }))

  it("refuses a colour another active type uses, unless it is inactive", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await adminOf(db)
      const product = await catalogTypeNamed(db, acme, "Product")
      const addOn = await catalogTypeNamed(db, acme, "Add-on")
      await expect(
        caller.catalogType.update({ id: addOn.id, colourIndex: 0 })
      ).rejects.toMatchObject({ code: "CONFLICT" })
      await caller.catalogType.update({ id: product.id, active: false })
      await caller.catalogType.update({ id: addOn.id, colourIndex: 0 })
      await expect(
        caller.catalogType.update({ id: product.id, active: true })
      ).rejects.toMatchObject({ code: "CONFLICT" })
    }))

  it("refuses removing a Billing Unit its items use, naming how many", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await adminOf(db)
      const addOn = await catalogTypeNamed(db, acme, "Add-on")
      await createCatalogItem(db, acme, { type: "Add-on", billingUnit: "hour" })
      await createCatalogItem(db, acme, {
        type: "Add-on",
        billingUnit: "hour",
        active: false,
      })
      await createCatalogItem(db, acme, { type: "Add-on", billingUnit: "each" })
      await expect(
        caller.catalogType.update({ id: addOn.id, billingUnits: ["each"] })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message:
          "2 Add-ons are billed Hour. Change their Billing Unit before removing Hour.",
      })
      await expect(
        caller.catalogType.update({ id: addOn.id, billingUnits: [] })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      // Adding a unit, or removing an unused one, is fine.
      const product = await catalogTypeNamed(db, acme, "Product")
      await caller.catalogType.update({
        id: product.id,
        billingUnits: ["each", "hour"],
      })
      expect(
        await caller.catalogType.update({
          id: product.id,
          billingUnits: ["hour"],
        })
      ).toMatchObject({ billingUnits: ["hour"] })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const product = await catalogTypeNamed(db, acme, "Product")
      await expectIsolated(db, {
        owner: acme,
        call: (caller) =>
          caller.catalogType.update({ id: product.id, singular: "Hacked" }),
        snapshot: () =>
          db
            .select()
            .from(schema.catalogTypes)
            .where(eq(schema.catalogTypes.id, product.id)),
      })
    }))
})

describe("catalogType.reorder", () => {
  it("puts the types in the given order", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const service = await caller.catalogType.create({
        singular: "Service",
        plural: "Services",
        billingUnits: ["hour"],
      })
      const [product, addOn] = await caller.catalogType.list()
      await caller.catalogType.reorder({
        ids: [service.id, addOn!.id, product!.id],
      })
      expect((await caller.catalogType.list()).map((t) => t.singular)).toEqual([
        "Service",
        "Add-on",
        "Product",
      ])
    }))

  it("needs every type exactly once", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const [product, addOn] = await caller.catalogType.list()
      await expect(
        caller.catalogType.reorder({ ids: [product!.id] })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      await expect(
        caller.catalogType.reorder({
          ids: [product!.id, product!.id, addOn!.id],
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const product = await catalogTypeNamed(db, acme, "Product")
      const addOn = await catalogTypeNamed(db, acme, "Add-on")
      await expectIsolated(db, {
        owner: acme,
        call: (caller) =>
          caller.catalogType.reorder({ ids: [addOn.id, product.id] }),
        snapshot: () =>
          db
            .select({
              id: schema.catalogTypes.id,
              sequence: schema.catalogTypes.sequence,
            })
            .from(schema.catalogTypes)
            .where(eq(schema.catalogTypes.organizationId, acme.id)),
      })
    }))
})

describe("catalogType.delete", () => {
  it("deletes an unused type", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await adminOf(db)
      const product = await catalogTypeNamed(db, acme, "Product")
      expect(await caller.catalogType.delete({ id: product.id })).toEqual({
        id: product.id,
      })
      expect((await caller.catalogType.list()).map((t) => t.singular)).toEqual([
        "Add-on",
      ])
    }))

  it("refuses a type with Catalog Items, suggesting deactivate", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await adminOf(db)
      const product = await catalogTypeNamed(db, acme, "Product")
      await createCatalogItem(db, acme, { name: "Widget", active: false })
      const error = await caller.catalogType
        .delete({ id: product.id })
        .catch((e: unknown) => e)
      expect(error).toMatchObject({
        code: "CONFLICT",
        message:
          "“Products” is used by 1 Catalog Item (Widget). Deactivate it instead.",
      })
      expect(inUseDetails((error as { cause?: unknown }).cause)).toMatchObject({
        entity: "catalog_type",
        counts: { catalogItems: 1 },
        suggestion: "deactivate",
      })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const product = await catalogTypeNamed(db, acme, "Product")
      await expectIsolated(db, {
        owner: acme,
        call: (caller) => caller.catalogType.delete({ id: product.id }),
        snapshot: () =>
          db
            .select()
            .from(schema.catalogTypes)
            .where(eq(schema.catalogTypes.id, product.id)),
      })
    }))
})
