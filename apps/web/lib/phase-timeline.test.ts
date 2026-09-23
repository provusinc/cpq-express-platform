import { describe, expect, it } from "vitest"

import { milestoneLabelRows, phaseTimeline } from "./phase-timeline"

const line = (
  id: string,
  phaseId: string | null,
  startDate: string,
  endDate: string
) => ({
  id,
  phaseId,
  startDate,
  endDate,
  lineTotal: "100",
  unitCost: "1",
  quantity: "10",
})

const quote = { startDate: "2026-10-01", endDate: "2027-03-31" }

describe("phaseTimeline", () => {
  it("lays sequential top-level Phases in one lane, in order, with weeks", () => {
    const t = phaseTimeline({
      quote,
      phases: [
        { id: "b", parentId: null, name: "Build", sequence: 1 },
        { id: "a", parentId: null, name: "Discovery", sequence: 0 },
        { id: "a1", parentId: "a", name: "Workshops", sequence: 0 },
      ],
      lines: [
        line("1", "a1", "2026-10-01", "2026-10-28"),
        line("2", "b", "2026-11-02", "2027-03-31"),
      ],
      milestones: [],
    })
    expect(t.lanes).toBe(1)
    expect(t.segments.map((s) => [s.name, s.weeks, s.lane, s.tint])).toEqual([
      ["Discovery", 4, 0, 1],
      ["Build", 21, 0, 2],
    ])
    expect(t.segments[0]!.left).toBe(0)
    const last = t.segments[1]!
    expect(last.left + last.width).toBeCloseTo(1)
  })

  it("puts overlapping Phases in another lane and lists undated ones", () => {
    const t = phaseTimeline({
      quote,
      phases: [
        { id: "a", parentId: null, name: "Design", sequence: 0 },
        { id: "b", parentId: null, name: "Build", sequence: 1 },
        { id: "c", parentId: null, name: "Later", sequence: 2 },
      ],
      lines: [
        line("1", "a", "2026-10-01", "2026-12-31"),
        line("2", "b", "2026-12-01", "2027-02-28"),
      ],
      milestones: [],
    })
    expect(t.lanes).toBe(2)
    expect(t.segments.map((s) => s.lane)).toEqual([0, 1])
    expect(t.undated).toEqual([{ id: "c", name: "Later" }])
  })

  it("places Milestones by date, keeping edge labels inside", () => {
    const t = phaseTimeline({
      quote,
      phases: [],
      lines: [],
      milestones: [
        {
          id: "m2",
          name: "Final payment",
          date: "2027-03-31",
          colour: "#16a34a",
          completed: false,
        },
        {
          id: "m1",
          name: "Kickoff",
          date: "2026-10-01",
          colour: "#2563eb",
          completed: true,
        },
        {
          id: "m3",
          name: "Review",
          date: "2026-12-31",
          colour: "#7c3aed",
          completed: false,
        },
      ],
    })
    expect(t.milestones.map((m) => [m.name, m.align])).toEqual([
      ["Kickoff", "start"],
      ["Review", "center"],
      ["Final payment", "end"],
    ])
    expect(t.ticks[0]).toMatchObject({ label: "Oct 2026", offset: 0 })
  })
})

describe("milestoneLabelRows", () => {
  it("drops the second of two close labels a row", () => {
    expect(
      milestoneLabelRows(
        [0, 0.4, 0.9, 0.97, 0.99].map((offset) => ({ offset })),
        0.15
      )
    ).toEqual([0, 0, 0, 1, 0])
  })
})
