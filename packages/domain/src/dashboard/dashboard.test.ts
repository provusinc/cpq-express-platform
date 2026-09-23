import { describe, expect, it } from "vitest"

import { QUOTE_STATUSES } from "../enums"
import { fillMonths, OPEN_STATUSES, recentUtcMonths } from "./index"

describe("recentUtcMonths", () => {
  it("ends with the current UTC month, oldest first", () => {
    expect(recentUtcMonths("2026-09-23T12:00:00.000Z", 3)).toEqual([
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ])
  })

  it("crosses year boundaries", () => {
    expect(recentUtcMonths("2026-02-01T00:00:00.000Z", 4)).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ])
  })

  it("uses UTC, not the local day", () => {
    expect(recentUtcMonths("2026-09-30T23:30:00.000Z", 1)).toEqual([
      "2026-09-01",
    ])
    expect(recentUtcMonths(Date.parse("2026-10-01T00:00:00.000Z"), 1)).toEqual([
      "2026-10-01",
    ])
  })

  it("gives twelve months for a year", () => {
    const months = recentUtcMonths("2026-09-23T00:00:00.000Z", 12)
    expect(months).toHaveLength(12)
    expect(months[0]).toBe("2025-10-01")
  })
})

describe("fillMonths", () => {
  it("fills missing months with zeros and drops rows outside", () => {
    const months = ["2026-07-01", "2026-08-01", "2026-09-01"]
    expect(
      fillMonths(months, [
        { month: "2026-08-01", count: 2, value: "1500.5" },
        { month: "2026-01-01", count: 9, value: "99" },
      ])
    ).toEqual([
      { month: "2026-07-01", count: 0, value: "0.0000" },
      { month: "2026-08-01", count: 2, value: "1500.5000" },
      { month: "2026-09-01", count: 0, value: "0.0000" },
    ])
  })
})

describe("status sets", () => {
  it("open statuses are every status without a customer outcome", () => {
    expect(
      [...OPEN_STATUSES, "customer_approved", "customer_rejected"].sort()
    ).toEqual([...QUOTE_STATUSES].sort())
  })
})
