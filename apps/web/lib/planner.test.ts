import { describe, expect, it } from "vitest"

import {
  applyEditsLocally,
  bandAt,
  bucketPresets,
  currentPeriodIndex,
  heatLevel,
  isoWeek,
  phaseBands,
  dragFillEdits,
  dragFillRange,
  fillRange,
  formatAmount,
  movePos,
  NO_PHASE_ID,
  plannerPeriods,
  plannerRows,
  rangeOf,
  shownAllocations,
  sumAmounts,
} from "./planner"
import type { PlannerLine } from "./planner"

const line = (overrides: Partial<PlannerLine> = {}): PlannerLine => ({
  id: "a",
  phaseId: null,
  sourceKind: "resource_role",
  billingUnit: "hour",
  name: "Architect",
  startDate: "2026-10-01",
  endDate: "2026-12-31",
  quantity: "160.000",
  plannerManaged: false,
  allocations: [],
  ...overrides,
})

describe("plannerPeriods", () => {
  it("lists the buckets the Quote dates touch", () => {
    expect(plannerPeriods("months", "2026-10-15", "2026-12-02")).toEqual([
      {
        start: "2026-10-01",
        end: "2026-10-31",
        label: "Oct",
        sublabel: "2026",
        title: "Oct 2026",
        workingDays: 12,
      },
      {
        start: "2026-11-01",
        end: "2026-11-30",
        label: "Nov",
        sublabel: "2026",
        title: "Nov 2026",
        workingDays: 21,
      },
      {
        start: "2026-12-01",
        end: "2026-12-31",
        label: "Dec",
        sublabel: "2026",
        title: "Dec 2026",
        workingDays: 2,
      },
    ])
    expect(
      plannerPeriods("days", "2026-10-01", "2026-10-12").map((p) => p.start)
    ).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"])
    expect(
      plannerPeriods("quarters", "2026-11-01", "2027-02-01").map((p) => [
        p.label,
        p.sublabel,
        p.title,
      ])
    ).toEqual([
      ["Q4", "2026", "Q4 2026"],
      ["Q1", "2027", "Q1 2027"],
    ])
  })

  it("labels weeks by ISO week with their first day, capacity inside the Quote", () => {
    expect(plannerPeriods("weeks", "2026-10-01", "2026-10-12")).toEqual([
      {
        start: "2026-09-28",
        end: "2026-10-04",
        label: "W40",
        sublabel: "9/28",
        title: "W40 · Sep 28",
        workingDays: 2,
      },
      {
        start: "2026-10-05",
        end: "2026-10-11",
        label: "W41",
        sublabel: "10/5",
        title: "W41 · Oct 5",
        workingDays: 5,
      },
      {
        start: "2026-10-12",
        end: "2026-10-18",
        label: "W42",
        sublabel: "10/12",
        title: "W42 · Oct 12",
        workingDays: 1,
      },
    ])
  })
})

describe("isoWeek", () => {
  it.each([
    ["2026-01-01", 1],
    ["2026-12-28", 53],
    ["2027-01-04", 1],
    ["2021-01-03", 53],
    ["2024-12-30", 1],
  ])("%s is week %i", (day, week) => {
    expect(isoWeek(day)).toBe(week)
  })
})

describe("currentPeriodIndex", () => {
  const periods = plannerPeriods("weeks", "2026-10-01", "2026-10-20")
  it("finds the period holding today, or -1", () => {
    expect(currentPeriodIndex(periods, "2026-10-07")).toBe(1)
    expect(currentPeriodIndex(periods, "2026-10-25")).toBe(3)
    expect(currentPeriodIndex(periods, "2026-11-02")).toBe(-1)
  })
})

describe("bucketPresets", () => {
  it("scales a week's presets to the bucket", () => {
    expect(bucketPresets("week")).toEqual([40, 20, 12, 8, 4, 0])
    expect(bucketPresets("month")).toEqual([160, 80, 48, 32, 16, 0])
    expect(bucketPresets("quarter")).toEqual([480, 240, 144, 96, 48, 0])
  })
})

describe("heatLevel", () => {
  it.each([
    [undefined, 40, 0],
    ["0", 40, 0],
    ["1", 40, 1],
    ["10", 40, 1],
    ["10.5", 40, 2],
    ["20", 40, 2],
    ["30", 40, 3],
    ["32", 40, 4],
    ["40", 40, 4],
    ["40.5", 40, 5],
    ["8", 0, 5],
  ])("%s of %i hours is level %i", (amount, capacity, level) => {
    expect(heatLevel(amount, capacity)).toBe(level)
  })
})

describe("phaseBands", () => {
  const periods = plannerPeriods("weeks", "2026-10-05", "2026-11-15")
  const phase = (
    id: string,
    sequence: number,
    parentId: string | null = null
  ) => ({
    id,
    parentId,
    name: id,
    sequence,
  })
  const dated = (
    id: string,
    phaseId: string,
    startDate: string,
    endDate: string
  ) => ({
    id,
    phaseId,
    startDate,
    endDate,
    lineTotal: "0",
    unitCost: "0",
    quantity: "0",
  })

  it("spans each top-level Phase over the periods it covers most", () => {
    const bands = phaseBands(
      periods,
      [phase("Design", 1), phase("Discovery", 0), phase("Sub", 0, "Design")],
      [
        dated("a", "Discovery", "2026-10-05", "2026-10-23"),
        // A sub-Phase's lines count for its top-level Phase.
        dated("b", "Sub", "2026-10-24", "2026-11-06"),
      ]
    )
    expect(bands).toEqual([
      { phaseId: "Discovery", name: "Discovery", tint: 1, start: 0, span: 3 },
      { phaseId: "Design", name: "Design", tint: 2, start: 3, span: 2 },
    ])
  })

  it("leaves periods without a Phase out, and skips undated Phases", () => {
    const bands = phaseBands(
      periods,
      [phase("A", 0), phase("B", 1), phase("C", 2)],
      [
        dated("a", "A", "2026-10-05", "2026-10-09"),
        dated("c", "C", "2026-11-09", "2026-11-13"),
      ]
    )
    expect(bands).toEqual([
      { phaseId: "A", name: "A", tint: 1, start: 0, span: 1 },
      { phaseId: "C", name: "C", tint: 3, start: 5, span: 1 },
    ])
    expect(bandAt(bands, 5)?.phaseId).toBe("C")
    expect(bandAt(bands, 2)).toBeUndefined()
  })
})

describe("shownAllocations", () => {
  it("shows stored Allocations, or the default layout of the quantity", () => {
    const stored = [{ periodStart: "2026-10-01", amount: "8.000" }]
    expect(
      shownAllocations(
        line({ plannerManaged: true, allocations: stored }),
        "months"
      )
    ).toEqual(stored)
    const shown = shownAllocations(line(), "months")
    expect(shown.map((a) => a.periodStart)).toEqual([
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
    ])
    expect(sumAmounts(shown.map((a) => a.amount))).toBe("160")
  })
})

describe("plannerRows", () => {
  const phases = [
    { id: "p1", parentId: null, name: "Build", sequence: 1 },
    { id: "p0", parentId: null, name: "Discover", sequence: 0 },
    { id: "p2", parentId: "p1", name: "Backend", sequence: 0 },
    { id: "empty", parentId: null, name: "Empty", sequence: 2 },
  ]
  const lines = [
    line({ id: "l1", phaseId: "p2" }),
    line({ id: "l2", phaseId: "p0" }),
    line({ id: "l3" }),
  ]

  it("groups lines by Phase, depth first, skipping empty Phases", () => {
    const rows = plannerRows(lines, phases, new Set())
    expect(rows.map((r) => `${r.kind}:${r.id}:${r.depth}`)).toEqual([
      "phase:p0:0",
      "line:l2:1",
      "phase:p1:0",
      "phase:p2:1",
      "line:l1:2",
      `phase:${NO_PHASE_ID}:0`,
      "line:l3:1",
    ])
    expect(rows[2]).toMatchObject({ lineIds: ["l1"] })
  })

  it("hides what a collapsed Phase contains", () => {
    const rows = plannerRows(lines, phases, new Set(["p1", NO_PHASE_ID]))
    expect(rows.map((r) => r.id)).toEqual(["p0", "l2", "p1", NO_PHASE_ID])
  })

  it("has no headers without Phases", () => {
    expect(plannerRows([line({ id: "x" })], [], new Set())).toEqual([
      expect.objectContaining({ kind: "line", id: "x", depth: 0 }),
    ])
  })
})

describe("selection and fill", () => {
  const ids = ["a", "b", "c"]
  const periods = ["2026-10-01", "2026-11-01", "2026-12-01"]

  it("normalises ranges and clamps moves", () => {
    expect(rangeOf({ row: 2, col: 0 }, { row: 0, col: 1 })).toEqual({
      top: 0,
      bottom: 2,
      left: 0,
      right: 1,
    })
    expect(movePos({ row: 0, col: 0 }, -1, 5, 3, 3)).toEqual({ row: 0, col: 2 })
  })

  it("fills every cell of a range", () => {
    expect(
      fillRange({ top: 0, bottom: 1, left: 1, right: 2 }, ids, periods, "8")
    ).toEqual([
      { lineItemId: "a", periodStart: "2026-11-01", amount: "8" },
      { lineItemId: "a", periodStart: "2026-12-01", amount: "8" },
      { lineItemId: "b", periodStart: "2026-11-01", amount: "8" },
      { lineItemId: "b", periodStart: "2026-12-01", amount: "8" },
    ])
  })

  it("extends a drag-fill along the dominant axis and tiles the source", () => {
    const source = { top: 0, bottom: 0, left: 0, right: 1 }
    expect(dragFillRange(source, { row: 0, col: 1 })).toBeNull()
    const down = dragFillRange(source, { row: 2, col: 2 })
    expect(down).toEqual({ top: 0, bottom: 2, left: 0, right: 1 })
    const values: Record<string, string> = { "0:0": "8", "0:1": "16" }
    expect(
      dragFillEdits(source, down!, ids, periods, (r, c) => values[`${r}:${c}`])
    ).toEqual([
      { lineItemId: "b", periodStart: "2026-10-01", amount: "8" },
      { lineItemId: "b", periodStart: "2026-11-01", amount: "16" },
      { lineItemId: "c", periodStart: "2026-10-01", amount: "8" },
      { lineItemId: "c", periodStart: "2026-11-01", amount: "16" },
    ])
    const right = dragFillRange(
      { top: 0, bottom: 0, left: 0, right: 0 },
      { row: 0, col: 2 }
    )
    expect(
      dragFillEdits(
        { top: 0, bottom: 0, left: 0, right: 0 },
        right!,
        ids,
        periods,
        () => undefined
      )
    ).toEqual([
      { lineItemId: "a", periodStart: "2026-11-01", amount: null },
      { lineItemId: "a", periodStart: "2026-12-01", amount: null },
    ])
  })
})

describe("applyEditsLocally", () => {
  const quote = { startDate: "2026-10-01", endDate: "2026-12-31" }

  it("applies edits on top of what the row shows", () => {
    const patches = applyEditsLocally(
      [line()],
      [
        { lineItemId: "a", periodStart: "2026-10-01", amount: "10" },
        { lineItemId: "a", periodStart: "2026-11-01", amount: null },
        { lineItemId: "a", periodStart: "2026-12-01", amount: null },
      ],
      "months",
      quote
    )
    expect(patches.get("a")).toEqual({
      allocations: [{ periodStart: "2026-10-01", amount: "10.000" }],
      plannerManaged: true,
      quantity: "10.000",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    })
  })

  it("skips a line whose edits the domain refuses", () => {
    expect(
      applyEditsLocally(
        [line()],
        [{ lineItemId: "a", periodStart: "2026-10-01", amount: "745" }],
        "months",
        quote
      ).size
    ).toBe(0)
  })

  it("formats amounts for cells", () => {
    expect(formatAmount("40.000")).toBe("40")
    expect(formatAmount("7.500")).toBe("7.5")
    expect(formatAmount("0.000")).toBe("")
    expect(formatAmount(undefined)).toBe("")
  })
})
