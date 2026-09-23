import { describe, expect, it } from "vitest"

import { formatMoney, isMoneyInput, trimMoney } from "./money"

describe("formatMoney", () => {
  it.each([
    ["1234.5000", "USD", "$1,234.50"],
    ["0.0000", "USD", "$0.00"],
    ["0.1250", "USD", "$0.125"],
    ["99999999999999.9999", "USD", "$99,999,999,999,999.9999"],
    ["1500.0000", "JPY", "¥1,500"],
  ])("formats %s %s as %s", (amount, currency, expected) => {
    expect(formatMoney(amount, currency)).toBe(expected)
  })
})

describe("isMoneyInput", () => {
  it.each([
    ["150", true],
    ["150.25", true],
    [" 0.1234 ", true],
    ["-1", false],
    ["1.23456", false],
    ["1e3", false],
    ["", false],
    ["1,000", false],
  ])("%j → %s", (value, expected) => {
    expect(isMoneyInput(value)).toBe(expected)
  })
})

describe("trimMoney", () => {
  it.each([
    ["150.0000", "150"],
    ["12.5000", "12.5"],
    ["0.1250", "0.125"],
    ["100", "100"],
  ])("%s → %s", (amount, expected) => {
    expect(trimMoney(amount)).toBe(expected)
  })
})
