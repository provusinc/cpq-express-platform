import { describe, expect, it } from "vitest"

import { fromLocalDay, toLocalDay } from "./format"

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
