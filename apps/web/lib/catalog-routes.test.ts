import { describe, expect, it } from "vitest"

import { firstCatalogType, legacyCatalogType } from "./catalog-routes"

const type = (
  id: string,
  singular: string,
  sequence: number,
  active = true
) => ({ id, singular, plural: `${singular}s`, active, sequence })

describe("legacyCatalogType", () => {
  it("finds the type still named like the default", () => {
    const types = [type("b", "Add-on", 1), type("a", "Product", 0)]
    expect(legacyCatalogType(types, "product")?.id).toBe("a")
    expect(legacyCatalogType(types, "add_on")?.id).toBe("b")
  })

  it("falls back to the default's position, then the first type", () => {
    const renamed = [type("a", "Device", 0), type("b", "Service", 1)]
    expect(legacyCatalogType(renamed, "product")?.id).toBe("a")
    expect(legacyCatalogType(renamed, "add_on")?.id).toBe("b")
    expect(legacyCatalogType([type("a", "Device", 0)], "add_on")?.id).toBe("a")
    expect(legacyCatalogType([], "product")).toBeUndefined()
  })
})

describe("firstCatalogType", () => {
  it("prefers the first active type", () => {
    expect(
      firstCatalogType([type("a", "Old", 0, false), type("b", "New", 1)])?.id
    ).toBe("b")
    expect(firstCatalogType([type("a", "Old", 0, false)])?.id).toBe("a")
  })
})
