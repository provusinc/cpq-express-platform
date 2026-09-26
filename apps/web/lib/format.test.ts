import { describe, expect, it } from "vitest"

import {
  formatDateRange,
  formatMonthDay,
  fromLocalDay,
  toLocalDay,
} from "./format"

describe("fromLocalDay / toLocalDay", () => {
  it.each(["2026-01-01", "2026-02-28", "2026-12-31", "2024-02-29"])(
    "round-trips %s through a date picker's timestamp",
    (day) => {
      expect(toLocalDay(fromLocalDay(day))).toBe(day)
    }
  )

  it("maps a missing day to no timestamp and back", () => {
    expect(fromLocalDay(undefined)).toBeUndefined()
    expect(toLocalDay(undefined)).toBeUndefined()
  })

  it("is local midnight", () => {
    const date = new Date(fromLocalDay("2026-09-23")!)
    expect([date.getHours(), date.getMinutes(), date.getDate()]).toEqual([
      0, 0, 23,
    ])
  })
})

describe("formatDateRange", () => {
  it.each([
    ["2026-10-05", "2026-12-31", "Oct 5 – Dec 31, 2026"],
    ["2026-11-02", "2027-02-01", "Nov 2, 2026 – Feb 1, 2027"],
    ["2026-10-05", "2026-10-05", "Oct 5, 2026"],
  ])("%s … %s → %s", (start, end, text) => {
    expect(formatDateRange(start, end)).toBe(text)
  })
})

describe("formatMonthDay", () => {
  it("drops the year", () => {
    expect(formatMonthDay("2026-10-05")).toBe("Oct 5")
  })
})
