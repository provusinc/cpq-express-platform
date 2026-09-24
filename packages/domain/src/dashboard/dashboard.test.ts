import { describe, expect, it } from "vitest"

import { QUOTE_STATUSES } from "../enums"
import {
  OPEN_STATUSES,
  VALUE_RANGE_SPECS,
  VALUE_RANGES,
  valueBuckets,
  type ValueRange,
} from "./index"

describe("valueBuckets", () => {
  // 2026-09-23 is a Wednesday; its week starts on Monday 2026-09-21.
  it.each<[string, string, ValueRange, string, string, number]>([
    [
      "mid-week, 3 months",
      "2026-09-23T12:00:00.000Z",
      "90d",
      "2026-06-29",
      "2026-09-21",
      13,
    ],
    [
      "mid-week, 12 months",
      "2026-09-23T12:00:00.000Z",
      "12m",
      "2025-09-22",
      "2026-09-21",
      53,
    ],
    [
      "on a Monday",
      "2026-09-21T00:00:00.000Z",
      "90d",
      "2026-06-29",
      "2026-09-21",
      13,
    ],
    [
      "on a Sunday",
      "2026-09-27T23:59:59.000Z",
      "90d",
      "2026-06-29",
      "2026-09-21",
      13,
    ],
    [
      "30 days",
      "2026-09-23T12:00:00.000Z",
      "30d",
      "2026-08-25",
      "2026-09-23",
      30,
    ],
    ["7 days", "2026-09-23T12:00:00.000Z", "7d", "2026-09-17", "2026-09-23", 7],
    [
      "7 days across a year",
      "2026-01-02T08:00:00.000Z",
      "7d",
      "2025-12-27",
      "2026-01-02",
      7,
    ],
    [
      "UTC, not the local day",
      "2026-09-23T23:30:00.000Z",
      "7d",
      "2026-09-17",
      "2026-09-23",
      7,
    ],
  ])("%s", (_, now, range, from, last, count) => {
    const buckets = valueBuckets(now, range)
    expect(buckets.from).toBe(from)
    expect(buckets.last).toBe(last)
    expect(buckets.starts).toHaveLength(count)
    expect(buckets.starts[0]).toBe(from)
    expect(buckets.starts.at(-1)).toBe(last)
    expect(buckets.unit).toBe(VALUE_RANGE_SPECS[range].unit)
  })

  it("steps by the unit, with no gaps", () => {
    for (const range of VALUE_RANGES) {
      const { starts, unit } = valueBuckets(
        Date.parse("2026-03-30T10:00:00Z"),
        range
      )
      const step = unit === "week" ? 7 : 1
      for (let i = 1; i < starts.length; i++) {
        const gap =
          (Date.parse(starts[i]!) - Date.parse(starts[i - 1]!)) / 86_400_000
        expect(gap).toBe(step)
      }
      if (unit === "week") {
        expect(starts.every((d) => new Date(d).getUTCDay() === 1)).toBe(true)
      }
    }
  })

  it("covers at least the range's span", () => {
    const now = Date.parse("2026-09-21T00:00:00Z") // a Monday: shortest cover
    const days = (range: ValueRange) =>
      (now - Date.parse(valueBuckets(now, range).from)) / 86_400_000 + 1
    expect(days("12m")).toBeGreaterThanOrEqual(365)
    expect(days("90d")).toBeGreaterThanOrEqual(85)
    expect(days("30d")).toBe(30)
    expect(days("7d")).toBe(7)
  })
})

describe("status sets", () => {
  it("open statuses are every status without a customer outcome", () => {
    expect(
      [...OPEN_STATUSES, "customer_approved", "customer_rejected"].sort()
    ).toEqual([...QUOTE_STATUSES].sort())
  })
})
