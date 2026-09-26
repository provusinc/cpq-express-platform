import { describe, expect, it } from "vitest"

import { CUSTOMER_CLASSIFICATION_KINDS } from "../enums"
import {
  canChooseClassification,
  checkClassificationName,
  CUSTOMER_CLASSIFICATION_NAME_MAX,
  DEFAULT_CUSTOMER_CLASSIFICATIONS,
  DEFAULT_CUSTOMER_TYPES,
  sameClassificationName,
  selectableClassifications,
} from "./index"

describe("checkClassificationName", () => {
  it.each([
    ["Partner", "Partner"],
    ["  Reseller ", "Reseller"],
    ["x".repeat(CUSTOMER_CLASSIFICATION_NAME_MAX), "x".repeat(100)],
  ])("accepts %j as %j", (input, name) => {
    expect(checkClassificationName("customer_type", input)).toEqual({
      ok: true,
      name,
    })
  })

  it.each([
    ["", "blank"],
    ["   ", "blank"],
    ["x".repeat(CUSTOMER_CLASSIFICATION_NAME_MAX + 1), "too_long"],
  ])("refuses %j (%s)", (input, reason) => {
    expect(checkClassificationName("industry", input)).toMatchObject({
      ok: false,
      reason,
    })
  })

  it.each([
    ["customer_type", " partner", "Customer Type “partner” already exists."],
    ["industry", "RETAIL ", "Industry “RETAIL” already exists."],
  ] as const)(
    "refuses a %s name another value has, ignoring case and spaces",
    (kind, input, message) => {
      expect(
        checkClassificationName(kind, input, ["Partner", "Retail"])
      ).toEqual({ ok: false, reason: "duplicate", message })
    }
  )
})

describe("sameClassificationName", () => {
  it.each([
    ["Retail", " retail ", true],
    ["Retail", "Retailer", false],
  ])("%j vs %j → %s", (a, b, same) => {
    expect(sameClassificationName(a, b)).toBe(same)
  })
})

describe("the defaults", () => {
  it("are valid, distinct names for every list", () => {
    for (const kind of CUSTOMER_CLASSIFICATION_KINDS) {
      const names = DEFAULT_CUSTOMER_CLASSIFICATIONS[kind]
      expect(names.length).toBeGreaterThan(0)
      names.forEach((name, index) => {
        expect(
          checkClassificationName(kind, name, names.slice(0, index))
        ).toEqual({ ok: true, name })
      })
    }
    expect(DEFAULT_CUSTOMER_TYPES).toEqual(["Prospect", "Customer", "Partner"])
    expect(DEFAULT_CUSTOMER_CLASSIFICATIONS.industry).toHaveLength(15)
  })
})

describe("retired values", () => {
  const values = [
    { id: "a", name: "Prospect", retired: false },
    { id: "b", name: "Lead", retired: true },
    { id: "c", name: "Partner", retired: false },
  ]

  it.each([
    [null, ["a", "c"]],
    ["a", ["a", "c"]],
    ["b", ["a", "b", "c"]],
  ])("with current %j, a picker offers %j", (currentId, ids) => {
    expect(
      selectableClassifications(values, currentId).map((v) => v.id)
    ).toEqual(ids)
  })

  it("refuses a retired value unless the Customer already has it", () => {
    const lead = values[1]!
    expect(canChooseClassification("customer_type", lead, null)).toEqual({
      ok: false,
      reason: "retired",
      message: "Customer Type “Lead” is retired. Pick another value.",
    })
    expect(canChooseClassification("customer_type", lead, "b")).toEqual({
      ok: true,
    })
    expect(canChooseClassification("industry", values[0]!, null)).toEqual({
      ok: true,
    })
  })
})
