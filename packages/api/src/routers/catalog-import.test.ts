import { describe, expect, it } from "vitest"

import { asc, eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"

import {
  catalogTypeNamed,
  createCatalogType,
  createMember,
  createOrganization,
  organizationCaller,
  withTestDb,
} from "../test"

const { catalogItems, resourceRoles } = schema

async function setup(db: Db) {
  const organization = await createOrganization(db)
  const admin = await createMember(db, organization, { role: "admin" })
  const manager = await createMember(db, organization, { role: "manager" })
  return {
    organization,
    product: await catalogTypeNamed(db, organization, "Product"),
    addOn: await catalogTypeNamed(db, organization, "Add-on"),
    admin: organizationCaller(db, { organization, user: admin.user }),
    manager: organizationCaller(db, { organization, user: manager.user }),
  }
}

const itemsOf = (db: Db, organizationId: string) =>
  db
    .select()
    .from(catalogItems)
    .where(eq(catalogItems.organizationId, organizationId))
    .orderBy(asc(catalogItems.name))

const rolesOf = (db: Db, organizationId: string) =>
  db
    .select()
    .from(resourceRoles)
    .where(eq(resourceRoles.organizationId, organizationId))
    .orderBy(asc(resourceRoles.name))

/** Rows as the browser sends them (the old portal's CSV headers). */
const itemRow = (overrides: Record<string, string> = {}) => ({
  Name: "Basic Support Package",
  Type: "Product",
  Description: "Basic customer support service",
  Price: "75.00",
  Cost: "50.00",
  "Billing Unit": "Each",
  Tags: "support;basic",
  "Is Active": "TRUE",
  ...overrides,
})

const roleRow = (overrides: Record<string, string> = {}) => ({
  Name: "Junior Developer",
  Description: "Entry level developer",
  "Bill Rate": "75",
  "Cost Rate": "60",
  "Location Country": "Canada",
  "Location State": "Ontario",
  "Location City": "Toronto",
  "Is Active": "true",
  ...overrides,
})

describe("catalogItem.validateImport", () => {
  it("reports per-row errors without saving anything", () =>
    withTestDb(async (db) => {
      const { organization, product, addOn, admin } = await setup(db)
      const result = await admin.catalogItem.validateImport({
        catalogTypeId: product.id,
        rows: [
          itemRow(),
          itemRow({ Name: "Hourly Product", "Billing Unit": "Hour" }),
          itemRow({ Name: "No Price", Price: "" }),
          itemRow({ Name: "Bad Cost", Cost: "12.5.0" }),
          itemRow({ Name: "", "Billing Unit": "Daily", "Is Active": "maybe" }),
          // A Type column is ignored: the type is the page's.
          itemRow({ Name: "Elsewhere", Type: "Add-on", Price: "$1,125.00" }),
        ],
      })
      expect(result).toMatchObject({ validCount: 2, errorCount: 4 })
      const errors = result.rows.map((r) => r.errors.map((e) => e.column))
      expect(errors).toEqual([
        [],
        ["Billing Unit"],
        ["Price"],
        ["Cost"],
        ["Name", "Billing Unit", "Is Active"],
        [],
      ])
      expect(result.rows[1]!.errors[0]!.message).toBe(
        "Products are billed Each, not Hour."
      )
      expect(result.rows[4]!.errors[1]!.message).toBe(
        "Billing Unit must be Each (got “Daily”)."
      )
      expect(result.rows[2]!.errors[0]!.message).toBe("Price is required.")
      expect(result.rows[0]).toMatchObject({
        row: 1,
        values: {
          name: "Basic Support Package",
          price: "75.0000",
          tags: ["support", "basic"],
          active: true,
        },
      })
      expect(result.rows[5]!.values).toMatchObject({ price: "1125.0000" })
      const hourly = await admin.catalogItem.validateImport({
        catalogTypeId: addOn.id,
        rows: [itemRow({ "Billing Unit": "hour" })],
      })
      expect(hourly.rows[0]!.values).toMatchObject({ billingUnit: "hour" })
      expect(await itemsOf(db, organization.id)).toEqual([])
    }))

  it("defaults a blank Billing Unit from the type and matches headers loosely", () =>
    withTestDb(async (db) => {
      const { organization, addOn, admin } = await setup(db)
      const services = await createCatalogType(db, organization, {
        billingUnits: ["hour"],
      })
      const row = {
        name: "Code Review",
        PRICE: "50",
        cost: "30",
        is_active: "no",
      }
      expect(
        (
          await admin.catalogItem.validateImport({
            catalogTypeId: addOn.id,
            rows: [row],
          })
        ).rows[0]
      ).toMatchObject({
        errors: [],
        values: { billingUnit: "each", active: false, tags: [] },
      })
      expect(
        (
          await admin.catalogItem.validateImport({
            catalogTypeId: services.id,
            rows: [row],
          })
        ).rows[0]!.values
      ).toMatchObject({ billingUnit: "hour" })
    }))

  it("is for Admins only", () =>
    withTestDb(async (db) => {
      const { product, manager } = await setup(db)
      await expect(
        manager.catalogItem.validateImport({
          catalogTypeId: product.id,
          rows: [itemRow()],
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    }))
})

describe("catalogItem.import", () => {
  it("inserts every row, of the page's Catalog Type, when all are valid", () =>
    withTestDb(async (db) => {
      const { organization, addOn, admin } = await setup(db)
      expect(
        await admin.catalogItem.import({
          catalogTypeId: addOn.id,
          rows: [
            itemRow(),
            itemRow({
              Name: "Code Review",
              Type: "Product",
              "Billing Unit": "Hour",
              "Is Active": "false",
            }),
          ],
        })
      ).toEqual({ imported: 2 })
      expect(
        (await itemsOf(db, organization.id)).map((i) => ({
          name: i.name,
          catalogTypeId: i.catalogTypeId,
          billingUnit: i.billingUnit,
          price: i.price,
          active: i.active,
        }))
      ).toEqual([
        {
          name: "Basic Support Package",
          catalogTypeId: addOn.id,
          billingUnit: "each",
          price: "75.0000",
          active: true,
        },
        {
          name: "Code Review",
          catalogTypeId: addOn.id,
          billingUnit: "hour",
          price: "75.0000",
          active: false,
        },
      ])
    }))

  it("imports nothing when any row is invalid", () =>
    withTestDb(async (db) => {
      const { organization, product, admin } = await setup(db)
      const rows = Array.from({ length: 20 }, (_, i) =>
        itemRow({ Name: `Item ${i}` })
      )
      rows[17] = itemRow({ Name: "Broken", Price: "-3" })
      await expect(
        admin.catalogItem.import({ catalogTypeId: product.id, rows })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/^1 of 20 rows have errors/),
      })
      expect(await itemsOf(db, organization.id)).toEqual([])
    }))

  it("imports large files in one transaction", () =>
    withTestDb(async (db) => {
      const { organization, product, admin } = await setup(db)
      const rows = Array.from({ length: 1201 }, (_, i) =>
        itemRow({ Name: `Item ${i}` })
      )
      expect(
        await admin.catalogItem.import({ catalogTypeId: product.id, rows })
      ).toEqual({ imported: 1201 })
      expect(await itemsOf(db, organization.id)).toHaveLength(1201)
    }))

  it("refuses an inactive Catalog Type", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      const retired = await createCatalogType(db, organization, {
        active: false,
      })
      await expect(
        admin.catalogItem.import({
          catalogTypeId: retired.id,
          rows: [itemRow()],
        })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
      expect(await itemsOf(db, organization.id)).toEqual([])
    }))

  it("stays within the caller's Organization and is for Admins only", () =>
    withTestDb(async (db) => {
      const { organization, product, admin, manager } = await setup(db)
      await expect(
        manager.catalogItem.import({
          catalogTypeId: product.id,
          rows: [itemRow()],
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
      const other = await createOrganization(db)
      await admin.catalogItem.import({
        catalogTypeId: product.id,
        rows: [itemRow()],
      })
      expect(await itemsOf(db, other.id)).toEqual([])
      expect(await itemsOf(db, organization.id)).toHaveLength(1)
      // Another Organization's type is not found.
      const theirs = await catalogTypeNamed(db, other, "Product")
      await expect(
        admin.catalogItem.import({
          catalogTypeId: theirs.id,
          rows: [itemRow()],
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" })
      expect(await itemsOf(db, other.id)).toEqual([])
    }))

  it("rejects an empty file", () =>
    withTestDb(async (db) => {
      const { product, admin } = await setup(db)
      await expect(
        admin.catalogItem.import({ catalogTypeId: product.id, rows: [] })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))
})

describe("resourceRole.validateImport", () => {
  it("reports per-row errors, accepting the old portal's headers", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      const result = await admin.resourceRole.validateImport({
        rows: [
          roleRow(),
          // The old portal's resource_roles.csv: Price/Cost, Billing Unit.
          {
            Name: "Software Engineer",
            Description: "Senior software engineer",
            "Billing Unit": "Hour",
            Price: "150.00",
            Cost: "120.00",
            "Location Country": "United States",
            "Location State": "California",
            "Location City": "San Francisco",
            "Is Active": "TRUE",
          },
          roleRow({ Name: "Daily", "Billing Unit": "Each" }),
          roleRow({ Name: "No Rate", "Bill Rate": "" }),
        ],
      })
      expect(result).toMatchObject({ validCount: 2, errorCount: 2 })
      expect(result.rows[1]!.values).toMatchObject({
        billRate: "150.0000",
        costRate: "120.0000",
        locationCity: "San Francisco",
      })
      expect(result.rows[2]!.errors).toEqual([
        {
          column: "Billing Unit",
          message: "Resource Roles are always billed by the Hour.",
        },
      ])
      expect(result.rows[3]!.errors.map((e) => e.column)).toEqual(["Bill Rate"])
      expect(await rolesOf(db, organization.id)).toEqual([])
    }))
})

describe("resourceRole.import", () => {
  it("inserts every row when all are valid", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      expect(
        await admin.resourceRole.import({
          rows: [
            roleRow(),
            roleRow({ Name: "QA Engineer", "Location City": "" }),
          ],
        })
      ).toEqual({ imported: 2 })
      expect(
        (await rolesOf(db, organization.id)).map((r) => [
          r.name,
          r.billRate,
          r.locationCity,
        ])
      ).toEqual([
        ["Junior Developer", "75.0000", "Toronto"],
        ["QA Engineer", "75.0000", null],
      ])
    }))

  it("imports nothing when any row is invalid", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      await expect(
        admin.resourceRole.import({
          rows: [roleRow(), roleRow({ Name: "Bad", "Cost Rate": "abc" })],
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      expect(await rolesOf(db, organization.id)).toEqual([])
    }))

  it("is for Admins only", () =>
    withTestDb(async (db) => {
      const { manager } = await setup(db)
      await expect(
        manager.resourceRole.import({ rows: [roleRow()] })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    }))
})
