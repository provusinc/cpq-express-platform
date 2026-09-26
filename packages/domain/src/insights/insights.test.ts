import { describe, expect, it } from "vitest"

import { QUOTE_STAGES } from "../enums"
import type { QuoteStage } from "../enums"
import {
  ageInDays,
  daysUntil,
  DECIDED_STAGES,
  validUntilWindow,
  isValidUntilSoon,
  utcDay,
  type InsightKey,
  type InsightSeverity,
  insightSeverity,
  isLowMargin,
  LOW_MARGIN_STAGES,
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
    ["valid_until_soon", 0, "info"],
    ["valid_until_soon", 1, "warning"],
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
  const cases: Array<[string, string, QuoteStage, boolean]> = [
    ["1000", "14.9999", "draft", true],
    ["1000", "15.0000", "draft", false],
    ["1000", "-20", "draft", true],
    ["0", "0", "draft", false],
    ["-5", "0", "draft", false],
    ["0.0001", "0", "in_approval", true],
    ["1000", "10", "approved", false],
    ["1000", "10", "with_customer", false],
    ["1000", "10", "won", false],
    ["1000", "10", "lost", false],
  ]
  it.each(cases)(
    "Total %s, Margin %s %%, %s → %s",
    (total, marginPct, stage, expected) => {
      expect(isLowMargin({ total, marginPct, stage })).toBe(expected)
    }
  )

  it("counts exactly the Stages that aren't Decided", () => {
    expect([...LOW_MARGIN_STAGES, ...DECIDED_STAGES].sort()).toEqual(
      [...QUOTE_STAGES].sort()
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

describe("Valid Until soon", () => {
  const today = "2026-09-23"

  it("spans today to 14 days ahead", () => {
    expect(validUntilWindow(today)).toEqual({ from: today, to: "2026-10-07" })
    expect(validUntilWindow("2026-12-25")).toEqual({
      from: "2026-12-25",
      to: "2027-01-08",
    })
  })

  const cases: Array<[string | null, QuoteStage, boolean]> = [
    ["2026-09-23", "draft", true],
    ["2026-10-07", "approved", true],
    ["2026-10-08", "approved", false],
    ["2026-09-22", "with_customer", false],
    ["2026-09-30", "with_customer", true],
    ["2026-09-30", "in_approval", true],
    ["2026-09-30", "won", false],
    ["2026-09-30", "lost", false],
    [null, "draft", false],
  ]
  it.each(cases)("Valid Until %s, %s → %s", (validUntil, stage, expected) => {
    expect(isValidUntilSoon({ validUntil, stage }, today)).toBe(expected)
  })

  it("counts days until a date", () => {
    expect(daysUntil("2026-09-23", today)).toBe(0)
    expect(daysUntil("2026-09-24", today)).toBe(1)
    expect(daysUntil("2026-10-07", today)).toBe(14)
    expect(daysUntil("2026-09-20", today)).toBe(-3)
  })

  it("reads today as the UTC day", () => {
    expect(utcDay("2026-09-23T23:59:59.000Z")).toBe("2026-09-23")
    expect(utcDay(Date.parse("2026-09-24T00:00:00.000Z"))).toBe("2026-09-24")
  })
})
