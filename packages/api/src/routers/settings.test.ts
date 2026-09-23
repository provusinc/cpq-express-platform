/**
 * Organization settings (#20): company information and logo, Hours Per Day,
 * deletable Quote Statuses and Label Overrides. Reads are open to every
 * member; every change is Admin-only (`settings.manage`).
 */
import { describe, expect, it } from "vitest"

import { eq, organizationScope, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import { LOGO_MAX_BYTES } from "@workspace/domain/settings"

import { getOrganizationSettings } from "../settings"
import {
  createMember,
  createMemoryStorage,
  createOrganization,
  expectIsolated,
  organizationCaller,
  withTestDb,
} from "../test"
import type { TestCaller } from "../test"

const { labelOverrides, organizationSettings, organizations } = schema

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

/** Acme with an Admin caller sharing one in-memory store. */
async function acmeWithAdmin(db: Db) {
  const acme = await createOrganization(db, { name: "Acme" })
  const { user } = await createMember(db, acme, { role: "admin" })
  const storage = createMemoryStorage()
  const caller = organizationCaller(db, { organization: acme, user, storage })
  return { acme, caller, storage }
}

async function uploadLogo(
  caller: TestCaller,
  storage: ReturnType<typeof createMemoryStorage>,
  { contentType = "image/png", body = PNG } = {}
) {
  const upload = await caller.settings.requestLogoUpload({
    contentType,
    size: body.byteLength,
  })
  await storage.put(upload.key, body, { contentType })
  return upload
}

const COMPANY = {
  name: "Acme Corporation",
  email: "Sales@Acme.com",
  phone: "+1 555 0100",
  website: "acme.com",
  addressLine1: "1 Main Street",
  addressLine2: "",
  city: "Springfield",
  region: "IL",
  postalCode: "62701",
  country: "United States",
}

describe("reads are open to every member", () => {
  it.each([
    ["an Admin", "admin"],
    ["a Manager", "manager"],
    ["a Member", "member"],
  ] as const)("%s reads labels, Quoting settings and company", (_who, role) =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db, { name: "Acme" })
      const { user } = await createMember(db, acme, { role })
      const caller = organizationCaller(db, { organization: acme, user })

      expect(await caller.settings.quoting()).toEqual({
        hoursPerDay: "8.00",
        deletableStatuses: ["draft", "rejected"],
      })
      expect(await caller.settings.labels()).toMatchObject({
        resource_role: { singular: "Resource Role", plural: "Resource Roles" },
        product: { singular: "Product", enabled: true },
        add_on: { plural: "Add-ons", enabled: true },
        phase: { singular: "Phase" },
      })
      expect(await caller.settings.company()).toMatchObject({
        name: "Acme",
        email: null,
        logoUrl: null,
      })
    })
  )

  it("refuses a non-member on the Organization's subdomain", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const outsider = await createOrganization(db)
      const { user } = await createMember(db, outsider, { role: "admin" })
      const caller = organizationCaller(db, { organization: acme, user })
      for (const call of [
        () => caller.settings.labels(),
        () => caller.settings.quoting(),
        () => caller.settings.company(),
      ]) {
        await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" })
      }
    }))
})

describe("settings.manage is Admin-only", () => {
  const commands = (caller: TestCaller) => ({
    "settings.updateCompany": () => caller.settings.updateCompany(COMPANY),
    "settings.updateQuoting": () =>
      caller.settings.updateQuoting({
        hoursPerDay: "7.5",
        deletableStatuses: ["draft"],
      }),
    "settings.updateLabels": () =>
      caller.settings.updateLabels({
        overrides: [{ term: "phase", singular: "Workstream", enabled: true }],
      }),
    "settings.requestLogoUpload": () =>
      caller.settings.requestLogoUpload({ contentType: "image/png", size: 10 }),
    "settings.confirmLogoUpload": () =>
      caller.settings.confirmLogoUpload({ key: "organizations/x/logo/a.png" }),
    "settings.removeLogo": () => caller.settings.removeLogo(),
  })

  it.each([
    ["a Manager", "manager", false],
    ["a Member", "member", false],
    ["an Approver who is a Manager", "manager", true],
  ] as const)("refuses %s", (_who, role, isApprover) =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db, { name: "Acme" })
      const { user } = await createMember(db, acme, { role, isApprover })
      const caller = organizationCaller(db, { organization: acme, user })
      for (const [name, call] of Object.entries(commands(caller))) {
        await expect(call(), name).rejects.toMatchObject({ code: "FORBIDDEN" })
      }
      expect(
        await db
          .select()
          .from(organizationSettings)
          .where(eq(organizationSettings.organizationId, acme.id))
      ).toEqual([])
      expect(await caller.settings.company()).toMatchObject({ name: "Acme" })
    })
  )

  it("refuses a non-member on the Organization's subdomain", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const outsider = await createOrganization(db)
      const { user } = await createMember(db, outsider, {
        role: "admin",
        isApprover: true,
      })
      const caller = organizationCaller(db, { organization: acme, user })
      for (const [name, call] of Object.entries(commands(caller))) {
        await expect(call(), name).rejects.toMatchObject({ code: "NOT_FOUND" })
      }
    }))
})

describe("company information", () => {
  it("saves the company information, normalised", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await acmeWithAdmin(db)
      const saved = await caller.settings.updateCompany(COMPANY)
      expect(saved).toEqual({
        ...COMPANY,
        email: "sales@acme.com",
        website: "https://acme.com",
        addressLine2: null,
        logoUrl: null,
      })
      const [row] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, acme.id))
      expect(row).toMatchObject({
        name: "Acme Corporation",
        city: "Springfield",
      })
      expect(await caller.organization.current()).toMatchObject({
        organization: { name: "Acme Corporation" },
      })
    }))

  it("clears optional fields that are left blank or omitted", () =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      await caller.settings.updateCompany(COMPANY)
      expect(
        await caller.settings.updateCompany({ name: "Acme", phone: " " })
      ).toMatchObject({ name: "Acme", phone: null, email: null, city: null })
    }))

  it.each([
    ["a blank name", { name: "  " }, "name"],
    ["a bad email", { email: "not-an-email" }, "email"],
    ["a bad website", { website: "ftp://acme.com" }, "website"],
    ["a website with spaces", { website: "acme dot com" }, "website"],
    ["a long phone", { phone: "1".repeat(41) }, "phone"],
  ])("refuses %s", (_what, change, field) =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      const error = await caller.settings
        .updateCompany({ ...COMPANY, ...change })
        .catch((e: unknown) => e)
      expect(error).toMatchObject({ code: "BAD_REQUEST" })
      expect(JSON.stringify(error)).toContain(field)
      expect(await caller.settings.company()).toMatchObject({ name: "Acme" })
    })
  )
})

describe("Hours Per Day and deletable statuses", () => {
  it("saves both and every reader sees them", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await acmeWithAdmin(db)
      const saved = await caller.settings.updateQuoting({
        hoursPerDay: "7.5",
        deletableStatuses: ["draft", "customer_rejected", "draft"],
      })
      expect(saved).toEqual({
        hoursPerDay: "7.50",
        deletableStatuses: ["draft", "customer_rejected"],
      })

      const { user } = await createMember(db, acme)
      const member = organizationCaller(db, { organization: acme, user })
      expect(await member.settings.quoting()).toEqual(saved)
      expect(
        await getOrganizationSettings(organizationScope(db, acme.id))
      ).toEqual(saved)

      // A second save updates the one row.
      await caller.settings.updateQuoting({
        hoursPerDay: 6,
        deletableStatuses: [],
      })
      const rows = await db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, acme.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        hoursPerDay: "6.00",
        deletableStatuses: [],
      })
    }))

  it.each(["0", "-1", "24.5", "abc", "", "7.125"])(
    "refuses Hours Per Day %j",
    (hoursPerDay) =>
      withTestDb(async (db) => {
        const { caller } = await acmeWithAdmin(db)
        await expect(
          caller.settings.updateQuoting({
            hoursPerDay,
            deletableStatuses: ["draft"],
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
        expect((await caller.settings.quoting()).hoursPerDay).toBe("8.00")
      })
  )

  it.each([
    "pending_approval",
    "approved",
    "pending_customer_approval",
    "customer_approved",
  ] as const)("never lets %s be deletable", (status) =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      const error = await caller.settings
        .updateQuoting({
          hoursPerDay: "8",
          deletableStatuses: ["draft", status],
        })
        .catch((e: unknown) => e)
      expect(error).toMatchObject({ code: "BAD_REQUEST" })
      expect(JSON.stringify(error)).toContain("deletableStatuses")
      expect((await caller.settings.quoting()).deletableStatuses).toEqual([
        "draft",
        "rejected",
      ])
    })
  )

  it("the database refuses committed statuses too", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      await expect(
        db.transaction((tx) =>
          tx.insert(organizationSettings).values({
            organizationId: acme.id,
            deletableStatuses: ["approved"],
          })
        )
      ).rejects.toThrow()
    }))
})

describe("Label Overrides", () => {
  it("renames terms, hides Products and Add-ons, and resets to canonical", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await acmeWithAdmin(db)
      const labels = await caller.settings.updateLabels({
        overrides: [
          {
            term: "resource_role",
            singular: " Consultant ",
            plural: "Consultants",
          },
          { term: "phase", singular: "Workstream", plural: "Workstreams" },
          { term: "add_on", singular: "", plural: "", enabled: false },
        ],
      })
      expect(labels).toEqual({
        resource_role: {
          singular: "Consultant",
          plural: "Consultants",
          enabled: true,
        },
        product: { singular: "Product", plural: "Products", enabled: true },
        add_on: { singular: "Add-on", plural: "Add-ons", enabled: false },
        phase: { singular: "Workstream", plural: "Workstreams", enabled: true },
      })

      // Any member sees them.
      const { user } = await createMember(db, acme)
      const member = organizationCaller(db, { organization: acme, user })
      expect(await member.settings.labels()).toEqual(labels)

      // Saving again replaces, and other terms are left alone.
      const reset = await caller.settings.updateLabels({
        overrides: [{ term: "resource_role", singular: "", plural: null }],
      })
      expect(reset.resource_role).toEqual({
        singular: "Resource Role",
        plural: "Resource Roles",
        enabled: true,
      })
      expect(reset.phase.singular).toBe("Workstream")
      expect(
        await db
          .select()
          .from(labelOverrides)
          .where(eq(labelOverrides.organizationId, acme.id))
      ).toHaveLength(3)
    }))

  it.each([
    [
      "hiding Resource Roles",
      [{ term: "resource_role" as const, enabled: false }],
    ],
    ["hiding Phases", [{ term: "phase" as const, enabled: false }]],
    [
      "a name over 40 characters",
      [{ term: "product" as const, singular: "x".repeat(41) }],
    ],
    [
      "the same term twice",
      [
        { term: "product" as const, singular: "Item" },
        { term: "product" as const, singular: "Thing" },
      ],
    ],
  ])("refuses %s", (_what, overrides) =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      await expect(
        caller.settings.updateLabels({ overrides })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      expect((await caller.settings.labels()).product.singular).toBe("Product")
    })
  )

  it("keeps each Organization's labels to itself", () =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      await caller.settings.updateLabels({
        overrides: [{ term: "product", singular: "Widget", plural: "Widgets" }],
      })
      const globex = await createOrganization(db)
      const { user } = await createMember(db, globex, { role: "admin" })
      const other = organizationCaller(db, { organization: globex, user })
      expect((await other.settings.labels()).product.singular).toBe("Product")
      await other.settings.updateLabels({
        overrides: [{ term: "product", singular: "Gadget" }],
      })
      expect((await caller.settings.labels()).product.singular).toBe("Widget")
    }))
})

describe("logo", () => {
  it("uploads through a presigned URL and stores only the key", () =>
    withTestDb(async (db) => {
      const { acme, caller, storage } = await acmeWithAdmin(db)
      const upload = await caller.settings.requestLogoUpload({
        contentType: "image/png",
        size: PNG.byteLength,
      })
      expect(upload.key).toMatch(
        new RegExp(`^organizations/${acme.id}/logo/[0-9a-f-]+\\.png$`)
      )
      expect(upload.headers).toEqual({ "Content-Type": "image/png" })
      expect(upload.url).toContain(upload.key)

      await storage.put(upload.key, PNG, { contentType: "image/png" })
      const company = await caller.settings.confirmLogoUpload({
        key: upload.key,
      })
      expect(company.logoUrl).toContain(upload.key)

      const [row] = await db
        .select({ logoKey: organizations.logoKey })
        .from(organizations)
        .where(eq(organizations.id, acme.id))
      expect(row!.logoKey).toBe(upload.key)
    }))

  it("replacing the logo deletes the previous object; removing deletes it too", () =>
    withTestDb(async (db) => {
      const { caller, storage } = await acmeWithAdmin(db)
      const first = await uploadLogo(caller, storage)
      await caller.settings.confirmLogoUpload({ key: first.key })
      const second = await uploadLogo(caller, storage, {
        contentType: "image/svg+xml",
        body: new TextEncoder().encode("<svg/>"),
      })
      await caller.settings.confirmLogoUpload({ key: second.key })
      expect([...storage.objects.keys()]).toEqual([second.key])

      expect(await caller.settings.removeLogo()).toMatchObject({
        logoUrl: null,
      })
      expect(storage.objects.size).toBe(0)
    }))

  it.each([
    ["a GIF", { contentType: "image/gif", size: 100 }],
    ["an HTML file", { contentType: "text/html", size: 100 }],
    ["an empty file", { contentType: "image/png", size: 0 }],
    [
      "a file over 2 MB",
      { contentType: "image/png", size: LOGO_MAX_BYTES + 1 },
    ],
  ])("refuses to start uploading %s", (_what, file) =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      await expect(
        caller.settings.requestLogoUpload(file)
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    })
  )

  it("refuses to confirm an upload that never arrived", () =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      const upload = await caller.settings.requestLogoUpload({
        contentType: "image/png",
        size: 10,
      })
      await expect(
        caller.settings.confirmLogoUpload({ key: upload.key })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" })
    }))

  it("refuses and deletes an uploaded object that isn't a valid logo", () =>
    withTestDb(async (db) => {
      const { caller, storage } = await acmeWithAdmin(db)
      const upload = await caller.settings.requestLogoUpload({
        contentType: "image/png",
        size: 10,
      })
      await storage.put(upload.key, "<html></html>", {
        contentType: "text/html",
      })
      await expect(
        caller.settings.confirmLogoUpload({ key: upload.key })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      expect(storage.objects.has(upload.key)).toBe(false)
      expect((await caller.settings.company()).logoUrl).toBeNull()
    }))

  it("never adopts another Organization's object as the logo", () =>
    withTestDb(async (db) => {
      const { caller: acmeAdmin, storage } = await acmeWithAdmin(db)
      const acmeUpload = await uploadLogo(acmeAdmin, storage)
      await acmeAdmin.settings.confirmLogoUpload({ key: acmeUpload.key })

      const globex = await createOrganization(db)
      const { user } = await createMember(db, globex, { role: "admin" })
      const globexAdmin = organizationCaller(db, {
        organization: globex,
        user,
        storage,
      })
      for (const key of [
        acmeUpload.key,
        `organizations/${globex.id}/logo/../../${acmeUpload.key}`,
        `organizations/${globex.id}/documents/x.png`,
      ]) {
        await expect(
          globexAdmin.settings.confirmLogoUpload({ key })
        ).rejects.toMatchObject({ code: "NOT_FOUND" })
      }
      expect((await globexAdmin.settings.company()).logoUrl).toBeNull()
      expect(storage.objects.has(acmeUpload.key)).toBe(true)
    }))

  it("confirming another Organization's upload key is isolated", () =>
    withTestDb(async (db) => {
      const { acme, caller, storage } = await acmeWithAdmin(db)
      const upload = await uploadLogo(caller, storage)
      await expectIsolated(db, {
        owner: acme,
        call: (outsider) =>
          outsider.settings.confirmLogoUpload({ key: upload.key }),
        snapshot: () =>
          db
            .select({ logoKey: organizations.logoKey })
            .from(organizations)
            .where(eq(organizations.id, acme.id)),
      })
    }))
})
