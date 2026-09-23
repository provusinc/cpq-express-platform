import { describe, expect, it } from "vitest"

import { QUOTE_STATUSES } from "../enums"
import type { QuoteStatus } from "../enums"
import {
  ageInDays,
  DECIDED_STATUSES,
  type InsightKey,
  type InsightSeverity,
  insightSeverity,
  isLowMargin,
  LOW_MARGIN_STATUSES,
  startOfUtcMonth,
} from "./index"

describe("insightSeverity: pending approval", () => {
  const cases: Array<[count: number, age: number | null, InsightSeverity]> = [
    [0, null, "info"],
    [0, 30, "info"],
    [1, null, "info"],
    [1, 0, "info"],
    [1, 2, "info"],
    [1, 3, "warning"],
    [1, 6, "warning"],
    [1, 7, "critical"],
    [2, 0, "warning"],
    [4, 2, "warning"],
    [4, 6, "warning"],
    [5, 0, "critical"],
    [12, 1, "critical"],
    [2, 7, "critical"],
  ]
  it.each(cases)("%i Quotes, oldest %s days → %s", (count, age, expected) => {
    expect(
      insightSeverity("pending_approval", { count, oldestAgeDays: age })
    ).toBe(expected)
  })
})

describe("insightSeverity: the other cards", () => {
  const cases: Array<[InsightKey, number, InsightSeverity]> = [
    ["rejected", 0, "info"],
    ["rejected", 2, "info"],
    ["rejected", 3, "warning"],
    ["rejected", 10, "warning"],
    ["low_margin", 0, "info"],
    ["low_margin", 1, "warning"],
    ["high_value_pipeline", 0, "info"],
    ["high_value_pipeline", 100, "info"],
    ["this_month", 0, "info"],
    ["this_month", 100, "info"],
  ]
  it.each(cases)("%s with %i → %s", (key, count, expected) => {
    expect(insightSeverity(key, { count })).toBe(expected)
  })
})

describe("isLowMargin", () => {
  const cases: Array<[string, string, QuoteStatus, boolean]> = [
    ["1000", "14.9999", "draft", true],
    ["1000", "15.0000", "draft", false],
    ["1000", "-20", "draft", true],
    ["0", "0", "draft", false],
    ["-5", "0", "draft", false],
    ["0.0001", "0", "pending_approval", true],
    ["1000", "10", "pending_customer_approval", true],
    ["1000", "10", "approved", false],
    ["1000", "10", "rejected", false],
    ["1000", "10", "customer_approved", false],
    ["1000", "10", "customer_rejected", false],
  ]
  it.each(cases)(
    "Total %s, Margin %s %%, %s → %s",
    (total, marginPct, status, expected) => {
      expect(isLowMargin({ total, marginPct, status })).toBe(expected)
    }
  )

  it("counts exactly the statuses that aren't decided", () => {
    expect([...LOW_MARGIN_STATUSES, ...DECIDED_STATUSES].sort()).toEqual(
      [...QUOTE_STATUSES].sort()
    )
  })
})

describe("ageInDays", () => {
  const now = "2026-09-23T12:00:00.000Z"
  const cases: Array<[string, number]> = [
    ["2026-09-23T12:00:00.000Z", 0],
    ["2026-09-22T12:00:01.000Z", 0],
    ["2026-09-22T12:00:00.000Z", 1],
    ["2026-09-16T12:00:00.000Z", 7],
    ["2026-09-16T13:00:00.000Z", 6],
    ["2026-09-24T00:00:00.000Z", 0],
  ]
  it.each(cases)("since %s → %i", (since, expected) => {
    expect(ageInDays(since, now)).toBe(expected)
  })

  it("takes epoch milliseconds", () => {
    expect(ageInDays(0, 3 * 86_400_000)).toBe(3)
  })
})

describe("startOfUtcMonth", () => {
  it.each([
    ["2026-09-23T12:00:00.000Z", "2026-09-01"],
    ["2026-09-01T00:00:00.000Z", "2026-09-01"],
    ["2026-09-30T23:59:59.999Z", "2026-09-01"],
    ["2026-10-01T00:00:00.000+02:00", "2026-09-01"],
    ["2026-12-31T23:59:59.000Z", "2026-12-01"],
  ])("%s → %s", (now, expected) => {
    expect(startOfUtcMonth(now)).toBe(expected)
  })
})
