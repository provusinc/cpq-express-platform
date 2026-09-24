import { describe, expect, it } from "vitest"

import {
  currencyMinorUnit,
  Decimal,
  roundToMinorUnit,
  sumDecimals,
  toMoneyString,
  toPercentString,
  toQuantityString,
} from "./index"

describe("money", () => {
  it("adds decimals exactly, unlike JS floats", () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(new Decimal("0.1").plus("0.2").toString()).toBe("0.3")
    expect(sumDecimals(["0.1", "0.2", 0.3]).toString()).toBe("0.6")
    expect(sumDecimals([]).toString()).toBe("0")
  })

  it.each([
    ["USD", 2],
    ["usd", 2],
    ["EUR", 2],
    ["JPY", 0],
    ["KWD", 3],
  ])("currency %s has %i minor-unit digits", (code, digits) => {
    expect(currencyMinorUnit(code)).toBe(digits)
  })

  it.each(["", "US", "DOLLARS", "12$"])("rejects currency code %j", (code) => {
    expect(() => currencyMinorUnit(code)).toThrow(RangeError)
  })

  it.each([
    ["1.005", "USD", "1.01"],
    ["1.004", "USD", "1"],
    ["-1.005", "USD", "-1.01"],
    ["99.999", "USD", "100"],
    ["1234.5", "JPY", "1235"],
    ["1.0005", "KWD", "1.001"],
  ])("rounds %s %s half-up to %s", (value, currency, expected) => {
    expect(roundToMinorUnit(value, currency).toString()).toBe(expected)
  })

  it.each([
    [toMoneyString, "1234.5", "1234.5000"],
    [toMoneyString, 0, "0.0000"],
    [toMoneyString, "0.00005", "0.0001"],
    [toPercentString, "25", "25.0000"],
    [toPercentString, "33.333333", "33.3333"],
    [toQuantityString, 40, "40.000"],
    [toQuantityString, "37.5", "37.500"],
  ] as const)("%o formats %j as %j for storage", (format, value, expected) => {
    expect(format(value)).toBe(expected)
  })
})
