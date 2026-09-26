import { describe, expect, it } from "vitest"

import {
  allocationHeat,
  daySpan,
  fitZoom,
  milestoneMarks,
  timelineTree,
  timelineView,
} from "./timeline-gantt"

describe("dates", () => {
  it("turns an inclusive day span into half-open UTC instants", () => {
    const span = daySpan("2026-10-01", "2026-10-31")
    expect(span.start.toISOString()).toBe("2026-10-01T00:00:00.000Z")
    expect(span.end.toISOString()).toBe("2026-11-01T00:00:00.000Z")
  })
})

describe("timelineTree", () => {
  const phases = [
    { id: "p1", name: "Discovery", parentId: null, sequence: 0 },
    { id: "p2", name: "Build", parentId: null, sequence: 1 },
    { id: "p3", name: "Backend", parentId: "p2", sequence: 0 },
    { id: "p4", name: "Empty", parentId: null, sequence: 2 },
  ]
  const lines = [
    { id: "l0", name: "Licence", phaseId: null, sequence: 0 },
    { id: "l1", name: "Architect", phaseId: "p1", sequence: 0 },
    { id: "l2", name: "Engineer", phaseId: "p3", sequence: 0 },
    { id: "l3", name: "PM", phaseId: "p2", sequence: 0 },
  ]

  it("nests Phases and Line Items in grid order", () => {
    expect(timelineTree(phases, lines)).toEqual([
      { id: "l0", title: "Licence" },
      {
        id: "p1",
        title: "Discovery",
        children: [{ id: "l1", title: "Architect" }],
      },
      {
        id: "p2",
        title: "Build",
        children: [
          { id: "l3", title: "PM" },
          {
            id: "p3",
            title: "Backend",
            children: [{ id: "l2", title: "Engineer" }],
          },
        ],
      },
      { id: "p4", title: "Empty", children: [] },
    ])
  })
})

describe("timelineView", () => {
  const quote = { startDate: "2026-10-01", endDate: "2027-03-31" }

  it("centres the Quote dates widened to lines and Milestones", () => {
    expect(timelineView(quote, [], [])).toMatchObject({
      centre: "2026-12-31",
      scale: "year",
    })
    expect(
      timelineView(
        quote,
        [{ startDate: "2026-09-01", endDate: "2026-10-10" }],
        ["2027-04-30"]
      ).centre
    ).toBe("2026-12-31")
  })

  it("picks the scale from the span", () => {
    const view = (endDate: string) =>
      timelineView({ startDate: "2026-10-01", endDate }, [], []).scale
    expect(view("2026-10-14")).toBe("month")
    expect(view("2026-12-01")).toBe("quarter")
    expect(view("2027-06-30")).toBe("year")
  })
})

describe("fitZoom", () => {
  const view = { centre: "2026-12-31", scale: "year", days: 182 } as const

  it("zooms out until the span fits the pane", () => {
    // ~6 months at 160px each ≈ 957px into a 750px pane
    expect(fitZoom(view, 750)).toBeCloseTo((750 * 0.92) / 956.7, 2)
  })

  it("never zooms in and stops at ReUI's minimum", () => {
    expect(fitZoom(view, 3000)).toBe(1)
    expect(fitZoom(view, 100)).toBe(0.5)
  })
})

describe("allocationHeat", () => {
  const role = {
    id: "l1",
    phaseId: null,
    sourceKind: "resource_role",
    billingUnit: "hour" as const,
    name: "Engineer",
    // Mon 5 Oct … Fri 23 Oct 2026: three whole weeks
    startDate: "2026-10-05",
    endDate: "2026-10-23",
    quantity: "60.000",
    plannerManaged: true,
    allocations: [
      { periodStart: "2026-10-05", amount: "40.000" },
      { periodStart: "2026-10-19", amount: "20.000" },
    ],
  }
  const settings = { timePeriod: "weeks" as const, hoursPerDay: "8.00" }

  it("shades each allocated week against its capacity, gaps left out", () => {
    const segments = allocationHeat(role, settings)
    expect(
      segments.map(({ periodStart, level }) => [periodStart, level])
    ).toEqual([
      ["2026-10-05", 4], // 40 of 40 hrs
      ["2026-10-19", 2], // 20 of 40 hrs
    ])
    expect(segments[0]!.from).toBe(0)
    expect(segments[0]!.to).toBeCloseTo(7 / 19)
    expect(segments[1]!.from).toBeCloseTo(14 / 19)
    expect(segments[1]!.to).toBe(1)
  })

  it("has none for Catalog Items and lines by the Each", () => {
    expect(
      allocationHeat({ ...role, sourceKind: "catalog_item" }, settings)
    ).toEqual([])
    expect(
      allocationHeat({ ...role, billingUnit: "each" as const }, settings)
    ).toEqual([])
  })
})

describe("milestoneMarks", () => {
  // 1 Oct … 31 Oct 2026 (31 days, half-open)
  const range = {
    start: new Date("2026-10-01T00:00:00Z"),
    end: new Date("2026-11-01T00:00:00Z"),
  }

  it("places each Milestone mid-day across the range, by date", () => {
    const marks = milestoneMarks(
      [
        { id: "b", date: "2026-10-16" },
        { id: "a", date: "2026-10-01" },
      ],
      range
    )
    expect(marks.map((m) => m.milestone.id)).toEqual(["a", "b"])
    expect(marks[0]!.at).toBeCloseTo(0.5 / 31)
    expect(marks[1]!.at).toBeCloseTo(15.5 / 31)
  })

  it("leaves out Milestones outside the range", () => {
    expect(
      milestoneMarks(
        [
          { id: "x", date: "2026-09-30" },
          { id: "y", date: "2026-11-01" },
        ],
        range
      )
    ).toEqual([])
  })
})
