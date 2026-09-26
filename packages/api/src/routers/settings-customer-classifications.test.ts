import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import { DEFAULT_CUSTOMER_CLASSIFICATIONS } from "@workspace/domain/customers"
import type { CustomerClassificationKind } from "@workspace/domain/enums"

import {
  createCustomer,
  createMember,
  createOrganization,
  customerClassification,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const { customerClassifications } = schema

/** An Organization with an Admin, and that Admin's caller. */
async function adminOf(db: Db) {
  const acme = await createOrganization(db)
  const { user } = await createMember(db, acme, { role: "admin" })
  return { acme, caller: organizationCaller(db, { organization: acme, user }) }
}

type Caller = Awaited<ReturnType<typeof adminOf>>["caller"]

const list = async (caller: Caller, kind: CustomerClassificationKind) =>
  (await caller.settings.customerClassifications()).filter(
    (v) => v.kind === kind
  )

const snapshotValue = (db: Db, id: string) => () =>
  db
    .select()
    .from(customerClassifications)
    .where(eq(customerClassifications.id, id))

describe("settings.customerClassifications", () => {
  it("lists both lists in order with their Customer counts, for any member", () =>
    withTestDb(async (db) => {
      const { acme } = await adminOf(db)
      const { user } = await createMember(db, acme)
      const prospect = await customerClassification(
        db,
        acme,
        "customer_type",
        "Prospect"
      )
      await createCustomer(db, acme, { customerTypeId: prospect })
      await createCustomer(db, acme, { customerTypeId: prospect })
      const values = await organizationCaller(db, {
        organization: acme,
        user,
      }).settings.customerClassifications()
      expect(
        values
          .filter((v) => v.kind === "customer_type")
          .map((v) => [v.name, v.customerCount])
      ).toEqual([
        ["Prospect", 2],
        ["Customer", 0],
        ["Partner", 0],
      ])
      expect(
        values.filter((v) => v.kind === "industry").map((v) => v.name)
      ).toEqual([...DEFAULT_CUSTOMER_CLASSIFICATIONS.industry])
      expect(values.map((v) => v.kind).indexOf("industry")).toBe(3)
    }))
})

describe("settings.createCustomerClassification", () => {
  it("adds a trimmed value at the end of its list", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const created = await caller.settings.createCustomerClassification({
        kind: "customer_type",
        name: "  Reseller ",
      })
      expect(created).toMatchObject({
        kind: "customer_type",
        name: "Reseller",
        sequence: 3,
        retired: false,
        customerCount: 0,
      })
      expect((await list(caller, "customer_type")).map((v) => v.name)).toEqual([
        "Prospect",
        "Customer",
        "Partner",
        "Reseller",
      ])
    }))

  it("keeps names unique per list, ignoring case, but not across lists", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      await expect(
        caller.settings.createCustomerClassification({
          kind: "customer_type",
          name: " partner",
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Customer Type “partner” already exists.",
      })
      await expect(
        caller.settings.createCustomerClassification({
          kind: "industry",
          name: "Partner",
        })
      ).resolves.toMatchObject({ kind: "industry", name: "Partner" })
      await expect(
        caller.settings.createCustomerClassification({
          kind: "industry",
          name: "   ",
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))

  it("enforces the unique name in the database too", () =>
    withTestDb(async (db) => {
      const { acme } = await adminOf(db)
      await expect(
        db.transaction((tx) =>
          tx.insert(customerClassifications).values({
            organizationId: acme.id,
            kind: "industry",
            name: "RETAIL",
            sequence: 99,
          })
        )
      ).rejects.toMatchObject({
        cause: {
          constraint_name:
            "customer_classifications_organization_id_kind_name_key",
        },
      })
    }))

  it("is for Admins only", () =>
    withTestDb(async (db) => {
      const { acme } = await adminOf(db)
      const { user } = await createMember(db, acme, { role: "manager" })
      await expect(
        organizationCaller(db, {
          organization: acme,
          user,
        }).settings.createCustomerClassification({
          kind: "industry",
          name: "Mining",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    }))
})

describe("settings.updateCustomerClassification", () => {
  it("renames a value, and the rename shows on its Customers", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await adminOf(db)
      const retail = await customerClassification(
        db,
        acme,
        "industry",
        "Retail"
      )
      const customer = await createCustomer(db, acme, { industryId: retail })
      await expect(
        caller.settings.updateCustomerClassification({
          id: retail,
          name: "Retail & E-commerce",
        })
      ).resolves.toMatchObject({
        name: "Retail & E-commerce",
        customerCount: 1,
      })
      expect(await caller.customer.byId({ id: customer.id })).toMatchObject({
        industry: { id: retail, name: "Retail & E-commerce" },
      })
      await expect(
        caller.settings.updateCustomerClassification({
          id: retail,
          name: "technology",
        })
      ).rejects.toMatchObject({ code: "CONFLICT" })
      // Its own name in another case is fine.
      await expect(
        caller.settings.updateCustomerClassification({
          id: retail,
          name: "RETAIL & E-COMMERCE",
        })
      ).resolves.toMatchObject({ name: "RETAIL & E-COMMERCE" })
    }))

  it("retires a value (kept where set, not offered) and brings it back", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await adminOf(db)
      const partner = await customerClassification(
        db,
        acme,
        "customer_type",
        "Partner"
      )
      const customer = await createCustomer(db, acme, {
        customerTypeId: partner,
      })
      await expect(
        caller.settings.updateCustomerClassification({
          id: partner,
          retired: true,
        })
      ).resolves.toMatchObject({ retired: true, customerCount: 1 })
      expect(await caller.customer.byId({ id: customer.id })).toMatchObject({
        customerTypeId: partner,
        customerType: { retired: true },
      })
      await expect(
        caller.customer.create({ name: "New", customerTypeId: partner })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      await caller.settings.updateCustomerClassification({
        id: partner,
        retired: false,
      })
      await expect(
        caller.customer.create({ name: "New", customerTypeId: partner })
      ).resolves.toMatchObject({ customerTypeId: partner })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { acme } = await adminOf(db)
      const retail = await customerClassification(
        db,
        acme,
        "industry",
        "Retail"
      )
      await expectIsolated(db, {
        owner: acme,
        call: (caller) =>
          caller.settings.updateCustomerClassification({
            id: retail,
            name: "Hacked",
            retired: true,
          }),
        snapshot: snapshotValue(db, retail),
      })
    }))
})

describe("settings.reorderCustomerClassifications", () => {
  it("puts a list in the given order", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const ids = (await list(caller, "customer_type")).map((v) => v.id)
      await caller.settings.reorderCustomerClassifications({
        kind: "customer_type",
        ids: [ids[2]!, ids[0]!, ids[1]!],
      })
      expect((await list(caller, "customer_type")).map((v) => v.name)).toEqual([
        "Partner",
        "Prospect",
        "Customer",
      ])
    }))

  it("refuses an incomplete list or another list's value", () =>
    withTestDb(async (db) => {
      const { caller } = await adminOf(db)
      const ids = (await list(caller, "customer_type")).map((v) => v.id)
      const [industry] = await list(caller, "industry")
      await expect(
        caller.settings.reorderCustomerClassifications({
          kind: "customer_type",
          ids: ids.slice(1),
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      await expect(
        caller.settings.reorderCustomerClassifications({
          kind: "customer_type",
          ids: [...ids.slice(1), industry!.id],
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await adminOf(db)
      const ids = (await list(caller, "customer_type")).map((v) => v.id)
      await expectIsolated(db, {
        owner: acme,
        call: (outsider) =>
          outsider.settings.reorderCustomerClassifications({
            kind: "customer_type",
            ids: [...ids].reverse(),
          }),
        snapshot: () =>
          db
            .select({
              id: customerClassifications.id,
              sequence: customerClassifications.sequence,
            })
            .from(customerClassifications)
            .where(eq(customerClassifications.organizationId, acme.id))
            .orderBy(customerClassifications.id),
      })
    }))
})

describe("settings.deleteCustomerClassification", () => {
  it("deletes an unused value", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await adminOf(db)
      const retail = await customerClassification(
        db,
        acme,
        "industry",
        "Retail"
      )
      await expect(
        caller.settings.deleteCustomerClassification({ id: retail })
      ).resolves.toEqual({ id: retail, kind: "industry" })
      expect(await snapshotValue(db, retail)()).toEqual([])
    }))

  it("refuses a value in use, suggesting retire, even when retired", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await adminOf(db)
      const retail = await customerClassification(
        db,
        acme,
        "industry",
        "Retail"
      )
      await createCustomer(db, acme, { name: "Initech", industryId: retail })
      await createCustomer(db, acme, { name: "Globex", industryId: retail })
      const refusal = {
        code: "CONFLICT",
        message:
          "“Retail” is used by 2 Customers (Globex, Initech). Retire it instead.",
      }
      await expect(
        caller.settings.deleteCustomerClassification({ id: retail })
      ).rejects.toMatchObject(refusal)
      await caller.settings.updateCustomerClassification({
        id: retail,
        retired: true,
      })
      await expect(
        caller.settings.deleteCustomerClassification({ id: retail })
      ).rejects.toMatchObject(refusal)
      expect(await snapshotValue(db, retail)()).toHaveLength(1)
    }))

  it("is backed by the Customers' references in the database", () =>
    withTestDb(async (db) => {
      const { acme } = await adminOf(db)
      const retail = await customerClassification(
        db,
        acme,
        "industry",
        "Retail"
      )
      await createCustomer(db, acme, { industryId: retail })
      await expect(
        db.transaction((tx) =>
          tx
            .delete(customerClassifications)
            .where(eq(customerClassifications.id, retail))
        )
      ).rejects.toMatchObject({
        cause: { constraint_name: "customers_industry_id_fk" },
      })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { acme } = await adminOf(db)
      const retail = await customerClassification(
        db,
        acme,
        "industry",
        "Retail"
      )
      await expectIsolated(db, {
        owner: acme,
        call: (caller) =>
          caller.settings.deleteCustomerClassification({ id: retail }),
        snapshot: snapshotValue(db, retail),
      })
    }))
})

describe("customer.create with another Organization's values", () => {
  it("can't point a Customer at them", () =>
    withTestDb(async (db) => {
      const { acme } = await adminOf(db)
      const retail = await customerClassification(
        db,
        acme,
        "industry",
        "Retail"
      )
      await expectIsolated(db, {
        owner: acme,
        call: (caller) =>
          caller.customer.create({ name: "Sneaky", industryId: retail }),
      })
    }))
})
