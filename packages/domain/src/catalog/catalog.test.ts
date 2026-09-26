import { describe, expect, it } from "vitest"

import {
  billingUnitsLabel,
  checkCatalogItemBillingUnit,
  DEFAULT_CATALOG_TYPES,
  defaultBillingUnit,
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
