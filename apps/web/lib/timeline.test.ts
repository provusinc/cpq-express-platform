import { describe, expect, it } from "vitest"

import {
  barSpan,
  dateOffset,
  dayCentre,
  timelineRange,
  timelineTicks,
} from "./timeline"

const quote = { startDate: "2026-10-01", endDate: "2026-12-31" }

describe("timelineRange", () => {
  it("is the Quote dates, widened to cover lines and Milestones", () => {
    expect(timelineRange(quote, [], [])).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
      days: 92,
    })
    expect(
      timelineRange(
        quote,
        [{ startDate: "2026-09-15", endDate: "2026-10-10" }],
        ["2027-01-15"]
      )
    ).toEqual({ start: "2026-09-15", end: "2027-01-15", days: 123 })
  })
})

describe("positions", () => {
  const range = timelineRange(
    { startDate: "2026-10-01", endDate: "2026-10-10" },
    [],
    []
  )
  it("places dates and inclusive bars as fractions", () => {
    expect(dateOffset(range, "2026-10-01")).toBe(0)
    expect(dateOffset(range, "2026-10-06")).toBe(0.5)
    expect(barSpan(range, "2026-10-01", "2026-10-10")).toEqual({
      left: 0,
      width: 1,
    })
    expect(barSpan(range, "2026-10-03", "2026-10-03")).toEqual({
      left: 0.2,
      width: 0.1,
    })
    expect(dayCentre(range, "2026-10-01")).toBe(0.05)
  })
})

describe("timelineTicks", () => {
  it("ticks each month, labelling the first tick and January with the year", () => {
    const ticks = timelineTicks(
      timelineRange({ startDate: "2026-11-15", endDate: "2027-02-10" }, [], [])
    )
    expect(ticks.map((t) => [t.date, t.label])).toEqual([
      ["2026-11-15", "Nov 2026"],
      ["2026-12-01", "Dec"],
      ["2027-01-01", "Jan 2027"],
      ["2027-02-01", "Feb"],
    ])
  })

  it("ticks Mondays for short ranges", () => {
    const ticks = timelineTicks(
      timelineRange({ startDate: "2026-10-01", endDate: "2026-10-20" }, [], [])
    )
    expect(ticks.map((t) => t.label)).toEqual(["5 Oct", "12 Oct", "19 Oct"])
  })
})
