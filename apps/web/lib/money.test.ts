import { describe, expect, it } from "vitest"

import {
  compactMoney,
  formatMoney,
  isMoneyInput,
  trimMoney,
  wholeMoney,
} from "./money"

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

describe("compactMoney", () => {
  it.each([
    [0, "$0"],
    [950, "$950"],
    [12_345, "$12.3K"],
    ["1250000.0000", "$1.3M"],
  ] as const)("%s → %s", (value, expected) => {
    expect(compactMoney(value, "USD")).toBe(expected)
  })
})

describe("wholeMoney", () => {
  it.each([
    ["1234.5000", "$1,235"],
    ["1234.4999", "$1,234"],
    ["0.0000", "$0"],
    ["-10.5000", "-$11"],
  ])("%s → %s", (value, expected) => {
    expect(wholeMoney(value, "USD")).toBe(expected)
  })
})
