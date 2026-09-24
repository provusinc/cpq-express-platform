import { describe, expect, it } from "vitest"

import {
  addDays,
  addPeriods,
  compareDates,
  countWorkingDays,
  daysBetween,
  endOfPeriod,
  isIsoDate,
  isPeriodStart,
  maxDate,
  minDate,
  periodStartsInRange,
  periodsBetween,
  periodTypeForTimePeriod,
  startOfPeriod,
} from "./index"

// 2026 anchors: Jan 1 is a Thursday, Jan 5 a Monday.

describe("isIsoDate", () => {
  it.each([
    ["2026-01-05", true],
    ["2028-02-29", true],
    ["2026-02-29", false],
    ["2026-13-01", false],
    ["2026-1-5", false],
    ["2026-01-05T00:00:00Z", false],
    ["", false],
    [20260105, false],
    [null, false],
  ])("%j → %s", (value, expected) => {
    expect(isIsoDate(value)).toBe(expected)
  })

  it("other functions reject malformed dates", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError)
  })
})

describe("date arithmetic", () => {
  it.each([
    ["2026-01-05", 1, "2026-01-06"],
    ["2026-01-31", 1, "2026-02-01"],
    ["2026-01-05", -7, "2025-12-29"],
    // Across DST changes in the US (Mar 8) and the EU (Mar 29).
    ["2026-03-07", 2, "2026-03-09"],
    ["2026-03-28", 2, "2026-03-30"],
    ["2026-10-24", 2, "2026-10-26"],
  ])("addDays(%s, %i) = %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected)
    expect(daysBetween(date, expected)).toBe(days)
  })

  it("compares, min and max", () => {
    expect(compareDates("2026-01-05", "2026-01-06")).toBeLessThan(0)
    expect(compareDates("2026-01-06", "2026-01-06")).toBe(0)
    expect(compareDates("2027-01-01", "2026-12-31")).toBeGreaterThan(0)
    expect(minDate("2026-01-05", "2025-12-31")).toBe("2025-12-31")
    expect(maxDate("2026-01-05", "2025-12-31")).toBe("2026-01-05")
  })
})

// Ported from portal quote-utils.test.ts (countWorkingDays).
describe("countWorkingDays", () => {
  it.each([
    ["Mon–Fri", "2026-01-05", "2026-01-09", 5],
    ["a single Monday", "2026-01-05", "2026-01-05", 1],
    ["Sat–Sun", "2026-01-10", "2026-01-11", 0],
    ["end before start", "2026-01-09", "2026-01-05", 0],
    ["Wed–Fri", "2026-01-14", "2026-01-16", 3],
    ["Wed–Tue", "2026-07-01", "2026-07-07", 5],
    ["two full weeks", "2026-01-05", "2026-01-18", 10],
    ["January 2026", "2026-01-01", "2026-01-31", 22],
    ["2026", "2026-01-01", "2026-12-31", 261],
  ])("%s: %s..%s → %i", (_name, start, end, expected) => {
    expect(countWorkingDays(start, end)).toBe(expected)
  })
})

describe("periodTypeForTimePeriod", () => {
  it.each([
    ["days", "week"],
    ["weeks", "week"],
    ["months", "month"],
    ["quarters", "quarter"],
  ] as const)("%s plans by %s", (timePeriod, periodType) => {
    expect(periodTypeForTimePeriod(timePeriod)).toBe(periodType)
  })
})

describe("bucket boundaries", () => {
  it.each([
    ["week", "2026-01-05", "2026-01-05", "2026-01-11"],
    ["week", "2026-01-07", "2026-01-05", "2026-01-11"],
    ["week", "2026-01-11", "2026-01-05", "2026-01-11"],
    ["week", "2026-01-01", "2025-12-29", "2026-01-04"],
    ["month", "2026-02-17", "2026-02-01", "2026-02-28"],
    ["month", "2028-02-10", "2028-02-01", "2028-02-29"],
    ["month", "2026-12-31", "2026-12-01", "2026-12-31"],
    ["quarter", "2026-01-01", "2026-01-01", "2026-03-31"],
    ["quarter", "2026-05-20", "2026-04-01", "2026-06-30"],
    ["quarter", "2026-09-30", "2026-07-01", "2026-09-30"],
    ["quarter", "2026-12-31", "2026-10-01", "2026-12-31"],
  ] as const)("%s containing %s is %s..%s", (type, date, start, end) => {
    expect(startOfPeriod(type, date)).toBe(start)
    expect(endOfPeriod(type, date)).toBe(end)
    expect(isPeriodStart(type, start)).toBe(true)
    expect(isPeriodStart(type, date)).toBe(date === start)
  })

  it.each([
    ["week", "2026-01-07", 1, "2026-01-12"],
    ["week", "2026-01-05", -1, "2025-12-29"],
    ["month", "2026-01-31", 1, "2026-02-01"],
    ["month", "2026-11-15", 2, "2027-01-01"],
    ["quarter", "2026-01-15", -1, "2025-10-01"],
    ["quarter", "2026-02-01", 3, "2026-10-01"],
  ] as const)("addPeriods(%s, %s, %i) = %s", (type, date, n, expected) => {
    expect(addPeriods(type, date, n)).toBe(expected)
  })

  it.each([
    ["week", "2026-01-05", "2026-01-14", 1],
    ["week", "2026-01-11", "2026-01-12", 1],
    ["week", "2026-01-12", "2026-01-11", -1],
    ["week", "2026-01-05", "2026-01-11", 0],
    ["month", "2026-01-31", "2026-02-01", 1],
    ["month", "2026-03-15", "2025-12-01", -3],
    ["quarter", "2026-03-31", "2026-04-01", 1],
    ["quarter", "2026-01-01", "2027-12-31", 7],
  ] as const)("periodsBetween(%s, %s, %s) = %i", (type, from, to, n) => {
    expect(periodsBetween(type, from, to)).toBe(n)
  })

  it.each([
    [
      "week",
      "2026-01-07",
      "2026-01-30",
      ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"],
    ],
    [
      "month",
      "2026-01-15",
      "2026-03-14",
      ["2026-01-01", "2026-02-01", "2026-03-01"],
    ],
    ["quarter", "2026-02-01", "2026-04-01", ["2026-01-01", "2026-04-01"]],
    ["week", "2026-01-30", "2026-01-05", []],
  ] as const)("buckets of %s over %s..%s", (type, start, end, expected) => {
    expect(periodStartsInRange(type, start, end)).toEqual(expected)
  })
})
