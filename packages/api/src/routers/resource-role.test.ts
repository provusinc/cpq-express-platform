import { describe, expect, it } from "vitest"

import { eq, schema } from "@workspace/db"
import type { Db } from "@workspace/db"

import {
  createMember,
  createOrganization,
  createResourceRole,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"

const { resourceRoles } = schema

async function setup(db: Db) {
  const organization = await createOrganization(db)
  const admin = await createMember(db, organization, { role: "admin" })
  const manager = await createMember(db, organization, { role: "manager" })
  const member = await createMember(db, organization)
  const as = ({ user }: { user: { id: string } } & typeof admin) =>
    organizationCaller(db, { organization, user })
  return {
    organization,
    admin: as(admin),
    manager: as(manager),
    member: as(member),
  }
}

const snapshotRole = (db: Db, id: string) => () =>
  db.select().from(resourceRoles).where(eq(resourceRoles.id, id))

describe("resourceRole.create", () => {
  it("creates a Resource Role with rates at storage scale", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      expect(
        await admin.resourceRole.create({
          name: "Solutions Architect",
          description: "Cloud solutions design",
          billRate: "185.00",
          costRate: 150,
          locationCountry: "United States",
          locationState: "Illinois",
          locationCity: "Chicago",
        })
      ).toMatchObject({
        organizationId: organization.id,
        name: "Solutions Architect",
        billRate: "185.0000",
        costRate: "150.0000",
        locationCity: "Chicago",
        active: true,
      })
    }))

  it("rejects negative or malformed rates", () =>
    withTestDb(async (db) => {
      const { admin } = await setup(db)
      for (const billRate of ["-5", "12.34567", "ten"]) {
        await expect(
          admin.resourceRole.create({ name: "X", billRate, costRate: "1" })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      }
    }))

  it("is for Admins only", () =>
    withTestDb(async (db) => {
      const { manager, member } = await setup(db)
      for (const caller of [manager, member]) {
        await expect(
          caller.resourceRole.create({
            name: "X",
            billRate: "1",
            costRate: "1",
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" })
      }
    }))
})

describe("resourceRole.list", () => {
  it("filters by status, rate range and location, for any member", () =>
    withTestDb(async (db) => {
      const { organization, member } = await setup(db)
      await createResourceRole(db, organization, {
        name: "Junior Developer",
        billRate: "75",
        locationCountry: "Canada",
        locationState: "Ontario",
        locationCity: "Toronto",
      })
      await createResourceRole(db, organization, {
        name: "Software Engineer",
        billRate: "150",
        locationCountry: "United States",
        locationState: "California",
        locationCity: "San Francisco",
      })
      await createResourceRole(db, organization, {
        name: "UX Designer",
        billRate: "115",
        locationCountry: "United States",
        locationState: "California",
        locationCity: "Los Angeles",
        active: false,
      })
      await createResourceRole(db, await createOrganization(db), {
        name: "Elsewhere",
      })
      const names = async (
        input: Parameters<typeof member.resourceRole.list>[0] = {}
      ) => (await member.resourceRole.list(input)).rows.map((r) => r.name)

      expect(await names()).toEqual([
        "Junior Developer",
        "Software Engineer",
        "UX Designer",
      ])
      expect(await names({ status: "active" })).toEqual([
        "Junior Developer",
        "Software Engineer",
      ])
      expect(await names({ minRate: "100", maxRate: "150" })).toEqual([
        "Software Engineer",
        "UX Designer",
      ])
      expect(await names({ country: "United States" })).toEqual([
        "Software Engineer",
        "UX Designer",
      ])
      expect(await names({ state: "California", city: "Los Angeles" })).toEqual(
        ["UX Designer"]
      )
      expect(await names({ search: "dev" })).toEqual(["Junior Developer"])
    }))
})

describe("resourceRole.locations", () => {
  it("lists the distinct locations in use", () =>
    withTestDb(async (db) => {
      const { organization, member } = await setup(db)
      for (const city of ["Toronto", "Toronto", "Ottawa"]) {
        await createResourceRole(db, organization, {
          locationCountry: "Canada",
          locationState: "Ontario",
          locationCity: city,
        })
      }
      await createResourceRole(db, organization)
      expect(await member.resourceRole.locations()).toEqual([
        { country: "Canada", state: "Ontario", city: "Ottawa" },
        { country: "Canada", state: "Ontario", city: "Toronto" },
      ])
    }))
})

describe("resourceRole.byId", () => {
  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const role = await createResourceRole(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.resourceRole.byId({ id: role.id }),
      })
    }))
})

describe("resourceRole.update", () => {
  it("changes only the given fields", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      const role = await createResourceRole(db, organization, {
        name: "QA Engineer",
        locationCity: "Austin",
      })
      expect(
        await admin.resourceRole.update({
          id: role.id,
          costRate: "80.25",
          locationCity: "",
        })
      ).toMatchObject({
        name: "QA Engineer",
        billRate: "150.0000",
        costRate: "80.2500",
        locationCity: null,
      })
    }))

  it("is for Admins only", () =>
    withTestDb(async (db) => {
      const { organization, member } = await setup(db)
      const role = await createResourceRole(db, organization)
      await expect(
        member.resourceRole.update({ id: role.id, name: "Nope" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const role = await createResourceRole(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) =>
          caller.resourceRole.update({ id: role.id, billRate: "1" }),
        snapshot: snapshotRole(db, role.id),
      })
    }))
})

describe("resourceRole.deactivate / reactivate", () => {
  it("toggles whether the role is active", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      const role = await createResourceRole(db, organization)
      expect(
        await admin.resourceRole.deactivate({ id: role.id })
      ).toMatchObject({ active: false })
      expect(
        await admin.resourceRole.reactivate({ id: role.id })
      ).toMatchObject({ active: true })
    }))

  it("is for Admins only", () =>
    withTestDb(async (db) => {
      const { organization, manager } = await setup(db)
      const role = await createResourceRole(db, organization)
      await expect(
        manager.resourceRole.deactivate({ id: role.id })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const role = await createResourceRole(db, organization)
      const inactive = await createResourceRole(db, organization, {
        active: false,
      })
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.resourceRole.deactivate({ id: role.id }),
        snapshot: snapshotRole(db, role.id),
      })
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.resourceRole.reactivate({ id: inactive.id }),
        snapshot: snapshotRole(db, inactive.id),
      })
    }))
})

describe("resourceRole.delete", () => {
  it("deletes an unused role", () =>
    withTestDb(async (db) => {
      const { organization, admin } = await setup(db)
      const role = await createResourceRole(db, organization)
      await admin.resourceRole.delete({ id: role.id })
      expect(await snapshotRole(db, role.id)()).toEqual([])
    }))

  it("is for Admins only", () =>
    withTestDb(async (db) => {
      const { organization, member } = await setup(db)
      const role = await createResourceRole(db, organization)
      await expect(
        member.resourceRole.delete({ id: role.id })
      ).rejects.toMatchObject({ code: "FORBIDDEN" })
      expect(await snapshotRole(db, role.id)()).toHaveLength(1)
    }))

  it("is isolated from other Organizations", () =>
    withTestDb(async (db) => {
      const { organization } = await setup(db)
      const role = await createResourceRole(db, organization)
      await expectIsolated(db, {
        owner: organization,
        call: (caller) => caller.resourceRole.delete({ id: role.id }),
        snapshot: snapshotRole(db, role.id),
      })
    }))
})
