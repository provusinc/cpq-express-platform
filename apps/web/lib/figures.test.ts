import { describe, expect, it } from "vitest"

import {
  compactHours,
  effortHours,
  initials,
  marginTone,
  quoteDuration,
} from "./figures"

describe("initials", () => {
  it.each([
    ["Acme Corp Express CPQ Demo", "AC"],
    ["globex", "G"],
    ["Healthcare – Records", "HR"],
    ["  ", ""],
    ["3M Health", "3H"],
  ])("%s → %s", (name, expected) => {
    expect(initials(name)).toBe(expected)
  })
})

describe("marginTone", () => {
  it.each([
    ["0.0000", "40.0000", "neutral"],
    ["100.0000", "-2.0000", "danger"],
    ["100.0000", "14.9999", "warning"],
    ["100.0000", "15.0000", "success"],
  ] as const)("Total %s, Margin %s%% → %s", (total, pct, tone) => {
    expect(marginTone(total, pct)).toBe(tone)
  })
})

describe("compactHours", () => {
  it.each([
    ["0.000", "0"],
    ["1120.000", "1,120"],
    ["9999.400", "9,999"],
    ["12345.000", "12.3K"],
  ])("%s → %s", (hours, expected) => {
    expect(compactHours(hours)).toBe(expected)
  })
})

describe("effortHours", () => {
  it("sums only the hourly lines", () => {
    expect(
      effortHours([
        { billingUnit: "hour", quantity: "160.000" },
        { billingUnit: "each", quantity: "2.000" },
        { billingUnit: "hour", quantity: "12.500" },
      ])
    ).toBe("172.500")
  })
})

describe("quoteDuration", () => {
  it.each([
    ["2026-10-01", "2027-03-31", 26, "wks"],
    ["2026-10-01", "2026-10-01", 1, "day"],
    ["2026-10-01", "2026-10-09", 9, "days"],
    ["2026-10-01", "2026-10-14", 2, "wks"],
  ] as const)("%s – %s → %d %s", (start, end, value, unit) => {
    expect(quoteDuration(start, end)).toEqual({ value, unit })
  })
})
