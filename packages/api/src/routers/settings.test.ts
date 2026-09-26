/**
 * Organization settings (#20): Organization profile and logo, Hours Per Day,
 * deletable Quote Statuses and Label Overrides. Reads are open to every
 * member; every change is Admin-only (`settings.manage`).
 */
import { describe, expect, it } from "vitest"

import { eq, organizationScope, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import { DEFAULT_DOCUMENT_SETTINGS } from "@workspace/domain/documents"
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

const PROFILE = {
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
  ] as const)("%s reads labels, Quoting settings and profile", (_who, role) =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db, { name: "Acme" })
      const { user } = await createMember(db, acme, { role })
      const caller = organizationCaller(db, { organization: acme, user })

      expect(await caller.settings.quoting()).toEqual({
        hoursPerDay: "8.00",
        deletableStages: ["draft"],
      })
      expect(await caller.settings.labels()).toMatchObject({
        resource_role: { singular: "Resource Role", plural: "Resource Roles" },
        phase: { singular: "Phase" },
      })
      expect(await caller.settings.profile()).toMatchObject({
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
        () => caller.settings.profile(),
      ]) {
        await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" })
      }
    }))
})

describe("settings.manage is Admin-only", () => {
  const commands = (caller: TestCaller) => ({
    "settings.updateProfile": () => caller.settings.updateProfile(PROFILE),
    "settings.updateQuoting": () =>
      caller.settings.updateQuoting({
        hoursPerDay: "7.5",
        deletableStages: ["draft"],
      }),
    "settings.updateLabels": () =>
      caller.settings.updateLabels({
        overrides: [{ term: "phase", singular: "Workstream" }],
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
      expect(await caller.settings.profile()).toMatchObject({ name: "Acme" })
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

describe("Organization profile", () => {
  it("saves the Organization profile, normalised", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await acmeWithAdmin(db)
      const saved = await caller.settings.updateProfile(PROFILE)
      expect(saved).toEqual({
        ...PROFILE,
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
      await caller.settings.updateProfile(PROFILE)
      expect(
        await caller.settings.updateProfile({ name: "Acme", phone: " " })
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
        .updateProfile({ ...PROFILE, ...change })
        .catch((e: unknown) => e)
      expect(error).toMatchObject({ code: "BAD_REQUEST" })
      expect(JSON.stringify(error)).toContain(field)
      expect(await caller.settings.profile()).toMatchObject({ name: "Acme" })
    })
  )
})

describe("Hours Per Day and deletable Stages", () => {
  it("saves both and every reader sees them", () =>
    withTestDb(async (db) => {
      const { acme, caller } = await acmeWithAdmin(db)
      const saved = await caller.settings.updateQuoting({
        hoursPerDay: "7.5",
        deletableStages: ["lost", "draft", "lost"],
      })
      expect(saved).toEqual({
        hoursPerDay: "7.50",
        deletableStages: ["lost", "draft"],
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
        deletableStages: [],
      })
      const rows = await db
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.organizationId, acme.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        hoursPerDay: "6.00",
        deletableStages: [],
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
            deletableStages: ["draft"],
          })
        ).rejects.toMatchObject({ code: "BAD_REQUEST" })
        expect((await caller.settings.quoting()).hoursPerDay).toBe("8.00")
      })
  )

  it.each(["in_approval", "approved", "with_customer", "won"] as const)(
    "never lets %s be deletable",
    (stage) =>
      withTestDb(async (db) => {
        const { caller } = await acmeWithAdmin(db)
        const error = await caller.settings
          .updateQuoting({
            hoursPerDay: "8",
            deletableStages: ["draft", stage],
          })
          .catch((e: unknown) => e)
        expect(error).toMatchObject({ code: "BAD_REQUEST" })
        expect(JSON.stringify(error)).toContain("deletableStages")
        expect((await caller.settings.quoting()).deletableStages).toEqual([
          "draft",
        ])
      })
  )

  it("the database refuses committed Stages too", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      await expect(
        db.transaction((tx) =>
          tx.insert(organizationSettings).values({
            organizationId: acme.id,
            deletableStages: ["approved"],
          })
        )
      ).rejects.toThrow()
    }))
})

describe("Label Overrides", () => {
  it("renames terms and resets to canonical", () =>
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
        ],
      })
      expect(labels).toEqual({
        resource_role: { singular: "Consultant", plural: "Consultants" },
        phase: { singular: "Workstream", plural: "Workstreams" },
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
      })
      expect(reset.phase.singular).toBe("Workstream")
      expect(
        await db
          .select()
          .from(labelOverrides)
          .where(eq(labelOverrides.organizationId, acme.id))
      ).toHaveLength(2)
    }))

  it.each([
    [
      "a name over 40 characters",
      [{ term: "phase" as const, singular: "x".repeat(41) }],
    ],
    [
      "the same term twice",
      [
        { term: "phase" as const, singular: "Item" },
        { term: "phase" as const, singular: "Thing" },
      ],
    ],
  ])("refuses %s", (_what, overrides) =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      await expect(
        caller.settings.updateLabels({ overrides })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
      expect((await caller.settings.labels()).phase.singular).toBe("Phase")
    })
  )

  it("refuses the Catalog Type terms (named directly now)", () =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      await expect(
        caller.settings.updateLabels({
          // @ts-expect-error: "product" is no Label Override term any more.
          overrides: [{ term: "product", singular: "Widget" }],
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    }))

  it("keeps each Organization's labels to itself", () =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      await caller.settings.updateLabels({
        overrides: [{ term: "phase", singular: "Widget", plural: "Widgets" }],
      })
      const globex = await createOrganization(db)
      const { user } = await createMember(db, globex, { role: "admin" })
      const other = organizationCaller(db, { organization: globex, user })
      expect((await other.settings.labels()).phase.singular).toBe("Phase")
      await other.settings.updateLabels({
        overrides: [{ term: "phase", singular: "Gadget" }],
      })
      expect((await caller.settings.labels()).phase.singular).toBe("Widget")
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
      const profile = await caller.settings.confirmLogoUpload({
        key: upload.key,
      })
      expect(profile.logoUrl).toContain(upload.key)

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
      expect((await caller.settings.profile()).logoUrl).toBeNull()
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
      expect((await globexAdmin.settings.profile()).logoUrl).toBeNull()
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

describe("document settings", () => {
  const SETTINGS = {
    format: "compact" as const,
    primaryColor: "#AABBCC",
    accentColor: "#f0a",
    sections: [
      { section: "line_items" as const, visible: true },
      { section: "header" as const, visible: false },
    ],
    moneyDecimals: 0,
    quantityDecimals: 1,
    locale: "de-de",
    footerText: "  Thank you  ",
    terms: "Net 30",
  }

  it("reads the defaults until saved, for every member", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      const { user } = await createMember(db, acme, { role: "member" })
      const caller = organizationCaller(db, { organization: acme, user })
      expect(await caller.settings.documents()).toEqual(
        DEFAULT_DOCUMENT_SETTINGS
      )
    }))

  it("saves normalised settings (Admin)", () =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      const saved = await caller.settings.updateDocuments(SETTINGS)
      expect(saved).toMatchObject({
        format: "compact",
        primaryColor: "#aabbcc",
        accentColor: "#ff00aa",
        moneyDecimals: 0,
        quantityDecimals: 1,
        locale: "de-DE",
        footerText: "Thank you",
        terms: "Net 30",
      })
      expect(saved.sections.slice(0, 3)).toEqual([
        { section: "line_items", visible: true },
        { section: "header", visible: false },
        { section: "bill_to", visible: true },
      ])
      expect(saved.sections).toHaveLength(8)
      expect(await caller.settings.documents()).toEqual(saved)

      // Saving again replaces the row.
      const again = await caller.settings.updateDocuments({
        ...SETTINGS,
        moneyDecimals: null,
        terms: "",
      })
      expect(again).toMatchObject({ moneyDecimals: null, terms: null })
    }))

  it.each([
    [{ primaryColor: "navy" }, "primaryColor"],
    [{ accentColor: "#12345g" }, "accentColor"],
    [{ moneyDecimals: 7 }, "moneyDecimals"],
    [{ quantityDecimals: 4 }, "quantityDecimals"],
    [{ locale: "??" }, "locale"],
  ])("refuses %j", (patch, field) =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      const error = await caller.settings
        .updateDocuments({ ...SETTINGS, ...patch })
        .catch((e: unknown) => e)
      expect(error).toMatchObject({ code: "BAD_REQUEST" })
      expect(JSON.stringify((error as { cause?: unknown }).cause)).toContain(
        field
      )
    })
  )

  it("is Admin-only", () =>
    withTestDb(async (db) => {
      const acme = await createOrganization(db)
      for (const role of ["manager", "member"] as const) {
        const { user } = await createMember(db, acme, { role })
        const caller = organizationCaller(db, { organization: acme, user })
        await expect(
          caller.settings.updateDocuments(SETTINGS)
        ).rejects.toMatchObject({ code: "FORBIDDEN" })
      }
    }))

  it("is per Organization", () =>
    withTestDb(async (db) => {
      const { caller } = await acmeWithAdmin(db)
      await caller.settings.updateDocuments(SETTINGS)
      const globex = await createOrganization(db)
      const { user } = await createMember(db, globex, { role: "admin" })
      expect(
        await organizationCaller(db, {
          organization: globex,
          user,
        }).settings.documents()
      ).toEqual(DEFAULT_DOCUMENT_SETTINGS)
    }))
})
