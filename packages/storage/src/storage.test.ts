import { describe, expect, it } from "vitest"

import {
  createMemoryStorage,
  isOrganizationObjectKey,
  organizationObjectKey,
} from "./index"

const ORG = "0199f0a0-0000-7000-8000-000000000001"

describe("organizationObjectKey", () => {
  it("puts objects under the Organization's prefix", () => {
    expect(organizationObjectKey(ORG, "logo", "a.png")).toBe(
      `organizations/${ORG}/logo/a.png`
    )
  })

  it.each([
    ["a/b.png", "logo"],
    ["", "logo"],
    ["a.png", "Logo"],
    ["a.png", "../x"],
  ])("refuses name %j in area %j", (name, area) => {
    expect(() => organizationObjectKey(ORG, area, name)).toThrow(TypeError)
  })
})

describe("isOrganizationObjectKey", () => {
  it.each([
    [`organizations/${ORG}/logo/a.png`, true],
    [`organizations/${ORG}/logo/`, false],
    [`organizations/${ORG}/logo/x/a.png`, false],
    [`organizations/${ORG}/documents/a.pdf`, false],
    [`organizations/other/logo/a.png`, false],
    [`x/organizations/${ORG}/logo/a.png`, false],
  ])("%s → %s", (key, expected) => {
    expect(isOrganizationObjectKey(key, ORG, "logo")).toBe(expected)
  })
})

describe("createMemoryStorage", () => {
  it("stores, describes, reads and deletes objects", async () => {
    const storage = createMemoryStorage()
    await storage.put("k", "hello", { contentType: "text/plain" })
    expect(await storage.head("k")).toEqual({
      key: "k",
      contentType: "text/plain",
      size: 5,
    })
    const object = await storage.get("k")
    expect(new TextDecoder().decode(object!.body)).toBe("hello")
    await storage.delete("k")
    await storage.delete("k")
    expect(await storage.head("k")).toBeNull()
    expect(await storage.get("k")).toBeNull()
  })

  it("hands out presigned URLs that name the key", async () => {
    const storage = createMemoryStorage()
    const upload = await storage.presignPut("a/b.png", {
      contentType: "image/png",
      size: 10,
    })
    expect(upload.url).toContain("/a/b.png")
    expect(upload.headers).toEqual({ "Content-Type": "image/png" })
    expect(await storage.presignGet("a/b.png")).toContain("/a/b.png")
  })
})
