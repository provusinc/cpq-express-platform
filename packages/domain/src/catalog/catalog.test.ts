import { describe, expect, it } from "vitest"

import {
  billingUnitsLabel,
  CATALOG_TYPE_NAME_MAX,
  checkBillingUnitRemoval,
  checkCatalogItemBillingUnit,
  checkCatalogType,
  DEFAULT_CATALOG_TYPES,
  defaultBillingUnit,
  freeCatalogTypeColours,
  MAX_ACTIVE_CATALOG_TYPES,
} from "."

const services = {
  singular: "Service",
  plural: "Services",
  billingUnits: ["hour"] as const,
}

describe("checkCatalogItemBillingUnit", () => {
  it.each([
    [DEFAULT_CATALOG_TYPES[0]!, "each", true],
    [DEFAULT_CATALOG_TYPES[0]!, "hour", false],
    [DEFAULT_CATALOG_TYPES[1]!, "each", true],
    [DEFAULT_CATALOG_TYPES[1]!, "hour", true],
    [services, "each", false],
    [services, "hour", true],
  ] as const)("%s billed %s → %s", (type, unit, ok) => {
    expect(checkCatalogItemBillingUnit(type, unit).ok).toBe(ok)
  })

  it("names the type and its units when refusing", () => {
    expect(
      checkCatalogItemBillingUnit(DEFAULT_CATALOG_TYPES[0]!, "hour")
    ).toEqual({
      ok: false,
      reason: "billing_unit_not_allowed",
      message: "Products are billed Each, not Hour.",
    })
  })
})

describe("billingUnitsLabel / defaultBillingUnit", () => {
  it.each([
    [["each"], "Each", "each"],
    [["hour", "each"], "Each or Hour", "each"],
    [["hour"], "Hour", "hour"],
  ] as const)("%j", (units, label, unit) => {
    expect(billingUnitsLabel(units)).toBe(label)
    expect(
      defaultBillingUnit({ singular: "X", plural: "Xs", billingUnits: units })
    ).toBe(unit)
  })
})

const defaults = DEFAULT_CATALOG_TYPES.map((t) => ({ ...t, active: true }))

const draft = {
  singular: " Service ",
  plural: "Services",
  billingUnits: ["hour", "each"] as const,
  colourIndex: 2,
  active: true,
}

describe("checkCatalogType", () => {
  it("normalises a valid type", () => {
    expect(checkCatalogType(draft, defaults)).toEqual({
      ok: true,
      type: {
        singular: "Service",
        plural: "Services",
        billingUnits: ["each", "hour"],
        colourIndex: 2,
        active: true,
      },
    })
  })

  it.each([
    [{ singular: "  " }, "blank", "singular"],
    [{ plural: "" }, "blank", "plural"],
    [
      { singular: "x".repeat(CATALOG_TYPE_NAME_MAX + 1) },
      "too_long",
      "singular",
    ],
    [{ singular: "product" }, "duplicate_name", "singular"],
    [{ plural: " ADD-ONS " }, "duplicate_name", "plural"],
    [{ singular: "Products" }, "duplicate_name", "singular"],
    [{ billingUnits: [] }, "no_billing_unit", "billingUnits"],
    [{ colourIndex: 6 }, "invalid_colour", "colourIndex"],
    [{ colourIndex: 1.5 }, "invalid_colour", "colourIndex"],
    [{ colourIndex: 0 }, "colour_taken", "colourIndex"],
  ] as const)("%j → %s on %s", (change, reason, field) => {
    const check = checkCatalogType({ ...draft, ...change }, defaults)
    expect(check).toMatchObject({ ok: false, reason })
    expect(!check.ok && check.issues.map((i) => i.field)).toContain(field)
  })

  it("lets an inactive type share a colour", () => {
    expect(
      checkCatalogType({ ...draft, colourIndex: 0, active: false }, defaults).ok
    ).toBe(true)
    expect(
      checkCatalogType({ ...draft, colourIndex: 0 }, [
        { ...defaults[0]!, active: false },
      ]).ok
    ).toBe(true)
  })

  it(`allows at most ${MAX_ACTIVE_CATALOG_TYPES} active types`, () => {
    const others = Array.from({ length: MAX_ACTIVE_CATALOG_TYPES }, (_, i) => ({
      singular: `T${i}`,
      plural: `T${i}s`,
      colourIndex: i,
      active: true,
    }))
    expect(
      checkCatalogType({ ...draft, colourIndex: 0 }, others)
    ).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ reason: "too_many_active" }),
      ]),
    })
    expect(
      checkCatalogType({ ...draft, colourIndex: 0, active: false }, others).ok
    ).toBe(true)
  })

  it("reports every field's issue", () => {
    const check = checkCatalogType(
      {
        singular: "",
        plural: "",
        billingUnits: [],
        colourIndex: 0,
        active: true,
      },
      defaults
    )
    expect(!check.ok && check.issues.map((i) => i.field)).toEqual([
      "singular",
      "plural",
      "billingUnits",
      "colourIndex",
    ])
  })
})

describe("freeCatalogTypeColours", () => {
  it("leaves out the colours of active types", () => {
    expect(freeCatalogTypeColours(defaults)).toEqual([2, 3, 4, 5])
    expect(
      freeCatalogTypeColours([{ ...defaults[0]!, active: false }, defaults[1]!])
    ).toEqual([0, 2, 3, 4, 5])
  })
})

describe("checkBillingUnitRemoval", () => {
  const type = { singular: "Add-on", plural: "Add-ons" }
  it.each([
    [["each", "hour"], ["each"], { hour: 0, each: 4 }, null],
    [
      ["each", "hour"],
      ["each"],
      { hour: 3 },
      "3 Add-ons are billed Hour. Change their Billing Unit before removing Hour.",
    ],
    [
      ["each", "hour"],
      ["hour"],
      { each: 1 },
      "1 Add-on is billed Each. Change its Billing Unit before removing Each.",
    ],
    [["each"], ["each", "hour"], { each: 9 }, null],
  ] as const)("%j → %j with %j", (from, to, itemsByUnit, message) => {
    expect(checkBillingUnitRemoval({ type, from, to, itemsByUnit })).toEqual(
      message
        ? { ok: false, reason: "billing_unit_in_use", message }
        : { ok: true }
    )
  })
})
