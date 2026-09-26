import { describe, expect, it } from "vitest"

import {
  catalogTypeNamed,
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
