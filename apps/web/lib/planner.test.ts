import { describe, expect, it } from "vitest"

import {
  applyEditsLocally,
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
      { start: "2026-10-01", label: "Oct", sublabel: "2026" },
      { start: "2026-11-01", label: "Nov", sublabel: "2026" },
      { start: "2026-12-01", label: "Dec", sublabel: "2026" },
    ])
    expect(
      plannerPeriods("days", "2026-10-01", "2026-10-12").map((p) => p.start)
    ).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"])
    expect(plannerPeriods("quarters", "2026-11-01", "2027-02-01")).toEqual([
      { start: "2026-10-01", label: "Q4", sublabel: "2026" },
      { start: "2027-01-01", label: "Q1", sublabel: "2027" },
    ])
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
