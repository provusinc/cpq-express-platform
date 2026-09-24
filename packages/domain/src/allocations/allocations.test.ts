import { describe, expect, it } from "vitest"

import type { IsoDate } from "../dates"
import {
  type AllocationInput,
  applyAllocationEdits,
  checkAllocationAmount,
  defaultAllocations,
  diffAllocations,
  maxAllocationAmount,
  normalizeAllocations,
  resizeAllocatedEffort,
  sumAllocations,
} from "./index"

// 2026 anchors: Jan 5 is a Monday.
const W1 = "2026-01-05"
const W2 = "2026-01-12"
const W3 = "2026-01-19"
const W4 = "2026-01-26"
const W5 = "2026-02-02"
const W6 = "2026-02-09"
const W7 = "2026-02-16"
const W8 = "2026-02-23"

const weeks = (
  starts: IsoDate[],
  amounts: Array<number | string>
): AllocationInput[] =>
  starts.map((periodStart, i) => ({ periodStart, amount: amounts[i] ?? 0 }))

/** `{ "2026-01-05": 40, … }` for compact assertions. */
const cells = (
  allocations: ReadonlyArray<{ periodStart: string; amount: string }>
) =>
  Object.fromEntries(allocations.map((a) => [a.periodStart, Number(a.amount)]))

describe("maxAllocationAmount", () => {
  it.each([
    ["week", "hour", "168.000"],
    ["month", "hour", "744.000"],
    ["quarter", "hour", "2160.000"],
    ["week", "each", "1000.000"],
    ["month", "each", "4000.000"],
    ["quarter", "each", "12000.000"],
  ] as const)("%s / %s → %s", (periodType, billingUnit, max) => {
    expect(maxAllocationAmount(periodType, billingUnit)).toBe(max)
  })
})

describe("checkAllocationAmount", () => {
  it.each([
    ["168", "week", "hour", true],
    ["168.5", "week", "hour", "exceeds_max"],
    ["744", "month", "hour", true],
    ["745", "month", "hour", "exceeds_max"],
    ["2160", "quarter", "hour", true],
    ["2160.001", "quarter", "hour", "exceeds_max"],
    ["1000", "week", "each", true],
    ["1001", "week", "each", "exceeds_max"],
    ["4000", "month", "each", true],
    ["12000", "quarter", "each", true],
    ["2.5", "week", "each", "not_whole"],
    ["2.5", "week", "hour", true],
    ["0", "week", "hour", true],
    ["-1", "week", "hour", "negative"],
    ["abc", "week", "hour", "invalid"],
    ["Infinity", "week", "hour", "invalid"],
  ] as const)("%s per %s (%s) → %s", (amount, periodType, unit, expected) => {
    const result = checkAllocationAmount(amount, periodType, unit)
    if (expected === true) expect(result).toEqual({ ok: true })
    else expect(result).toMatchObject({ ok: false, reason: expected })
  })
})

describe("normalizeAllocations / sumAllocations", () => {
  it("snaps to bucket starts, merges, drops zeros and sorts", () => {
    const result = normalizeAllocations("weeks", [
      { periodStart: "2026-01-14", amount: "8" }, // Wed of W2
      { periodStart: W1, amount: 0 },
      { periodStart: W2, amount: "16.5" },
      { periodStart: "2026-01-06", amount: 40 }, // Tue of W1
    ])
    expect(result).toEqual([
      { periodStart: W1, amount: "40.000" },
      { periodStart: W2, amount: "24.500" },
    ])
    expect(sumAllocations(result)).toBe("64.500")
    expect(sumAllocations([])).toBe("0.000")
  })
})

// Ported from resource-planner-utils.test.ts (lineItemToPlannerValues without
// allocations). v1 plans in the Quote's own bucket (the old planner was always
// weekly) and spreads whole hours by working-day capacity via largest-remainder.
describe("defaultAllocations", () => {
  it.each([
    [
      "160 h over four weeks → 40 h a week",
      "weeks",
      "hour",
      160,
      W1,
      "2026-01-30",
      { [W1]: 40, [W2]: 40, [W3]: 40, [W4]: 40 },
    ],
    [
      "320 h over eight weeks → 40 h a week",
      "weeks",
      "hour",
      320,
      W1,
      "2026-02-27",
      {
        [W1]: 40,
        [W2]: 40,
        [W3]: 40,
        [W4]: 40,
        [W5]: 40,
        [W6]: 40,
        [W7]: 40,
        [W8]: 40,
      },
    ],
    [
      "40 h from a Wednesday → 24 h (Wed–Fri) then 16 h",
      "weeks",
      "hour",
      40,
      "2026-07-01",
      "2026-07-07",
      { "2026-06-29": 24, "2026-07-06": 16 },
    ],
    [
      "200 h from a Wednesday never overfills a week",
      "weeks",
      "hour",
      200,
      "2026-07-01",
      "2026-08-04",
      {
        "2026-06-29": 24,
        "2026-07-06": 40,
        "2026-07-13": 40,
        "2026-07-20": 40,
        "2026-07-27": 40,
        "2026-08-03": 16,
      },
    ],
    [
      "80 h over four weeks spreads evenly",
      "weeks",
      "hour",
      80,
      W1,
      "2026-01-30",
      { [W1]: 20, [W2]: 20, [W3]: 20, [W4]: 20 },
    ],
    [
      "100 h over three weeks stays in whole hours",
      "weeks",
      "hour",
      100,
      W1,
      "2026-01-23",
      { [W1]: 34, [W2]: 33, [W3]: 33 },
    ],
    ["Days plan by week", "days", "hour", 16, W1, "2026-01-06", { [W1]: 16 }],
    [
      "months weighted by working days (12, 20, 10)",
      "months",
      "hour",
      420,
      "2026-01-15",
      "2026-03-13",
      { "2026-01-01": 120, "2026-02-01": 200, "2026-03-01": 100 },
    ],
    [
      "one quarter",
      "quarters",
      "hour",
      480,
      "2026-01-01",
      "2026-03-31",
      { "2026-01-01": 480 },
    ],
    [
      "each-billed lines split evenly in whole units",
      "weeks",
      "each",
      10,
      W1,
      "2026-01-23",
      { [W1]: 4, [W2]: 3, [W3]: 3 },
    ],
    [
      "zero quantity → no Allocations",
      "weeks",
      "hour",
      0,
      W1,
      "2026-01-30",
      {},
    ],
    [
      "a weekend-only span still gets its Effort",
      "weeks",
      "hour",
      8,
      "2026-01-10",
      "2026-01-11",
      { [W1]: 8 },
    ],
  ] as const)(
    "%s",
    (
      _name,
      timePeriod,
      billingUnit,
      quantity,
      startDate,
      endDate,
      expected
    ) => {
      const result = defaultAllocations({
        timePeriod,
        billingUnit,
        quantity,
        startDate,
        endDate,
      })
      expect(cells(result)).toEqual(expected)
      const total = Object.values(expected).reduce((a: number, b) => a + b, 0)
      expect(Number(sumAllocations(result))).toBe(total)
    }
  )
})

// Ported from resource-planner-utils.test.ts (plannerValuesToLineItemUpdates).
describe("applyAllocationEdits", () => {
  const quote = { startDate: W1, endDate: "2026-02-27" }
  const edit = (
    line: {
      startDate: IsoDate
      endDate: IsoDate
      allocations?: AllocationInput[]
    },
    edits: Array<[IsoDate, number | string]>,
    overrides: { quote?: typeof quote; billingUnit?: "hour" | "each" } = {}
  ) =>
    applyAllocationEdits({
      timePeriod: "weeks",
      billingUnit: overrides.billingUnit ?? "hour",
      line: { allocations: [], ...line },
      quote: overrides.quote ?? quote,
      edits: edits.map(([periodStart, amount]) => ({ periodStart, amount })),
    })

  it("quantity is the sum of the allocated periods", () => {
    const result = edit({ startDate: W1, endDate: "2026-01-30" }, [
      [W1, 30],
      [W2, 40],
      [W3, 50],
      [W4, 0],
    ])
    expect(result).toMatchObject({ ok: true, quantity: "120.000" })
  })

  it("the end date is the end of the last allocated period", () => {
    const result = edit({ startDate: W1, endDate: "2026-01-30" }, [
      [W1, 40],
      [W2, 40],
      [W3, 40],
    ])
    expect(result).toMatchObject({ ok: true, endDate: "2026-01-25" })
  })

  it("keeps the exact end day while the last Allocation stays in that period", () => {
    const result = edit({ startDate: W1, endDate: "2026-01-30" }, [
      [W1, 40],
      [W4, 40],
    ])
    expect(result).toMatchObject({
      ok: true,
      quantity: "80.000",
      endDate: "2026-01-30",
    })
  })

  it("clearing every period zeroes the quantity and keeps the dates", () => {
    const result = edit(
      {
        startDate: W1,
        endDate: "2026-01-30",
        allocations: weeks([W1, W2], [40, 40]),
      },
      [
        [W1, 0],
        [W2, 0],
      ]
    )
    expect(result).toEqual({
      ok: true,
      allocations: [],
      quantity: "0.000",
      startDate: W1,
      endDate: "2026-01-30",
    })
  })

  it("moves the start back when an earlier period is allocated", () => {
    const result = edit(
      {
        startDate: W2,
        endDate: "2026-01-30",
        allocations: weeks([W2, W3], [40, 40]),
      },
      [[W1, 40]]
    )
    expect(result).toMatchObject({
      ok: true,
      startDate: W1,
      quantity: "120.000",
    })
  })

  it("keeps the exact start day while the first Allocation stays in that week", () => {
    const result = edit({ startDate: "2026-01-07", endDate: "2026-01-30" }, [
      [W1, 40],
      [W2, 40],
    ])
    expect(result).toMatchObject({ ok: true, startDate: "2026-01-07" })
  })

  it("moves the start later when the earliest Allocation is removed", () => {
    const result = edit(
      {
        startDate: W1,
        endDate: "2026-01-30",
        allocations: weeks([W1, W2, W3], [40, 40, 40]),
      },
      [[W1, 0]]
    )
    expect(result).toMatchObject({
      ok: true,
      startDate: W2,
      quantity: "80.000",
    })
  })

  it("never moves the start before a mid-week Quote start", () => {
    const result = edit(
      { startDate: W2, endDate: "2026-01-30" },
      [
        [W1, 40],
        [W2, 40],
      ],
      {
        quote: { startDate: "2026-01-06", endDate: "2026-02-27" },
      }
    )
    expect(result).toMatchObject({ ok: true, startDate: "2026-01-06" })
  })

  it("never moves the end past a mid-week Quote end", () => {
    const result = edit({ startDate: W1, endDate: "2026-01-30" }, [[W8, 40]], {
      quote: { startDate: W1, endDate: "2026-02-25" },
    })
    expect(result).toMatchObject({ ok: true, endDate: "2026-02-25" })
  })

  it("accepts any day of the target week", () => {
    const result = edit({ startDate: W1, endDate: "2026-01-30" }, [
      ["2026-01-08", 24],
    ])
    expect(result.ok && result.allocations).toEqual([
      { periodStart: W1, amount: "24.000" },
    ])
  })

  it.each([
    ["over the weekly maximum", [[W1, 169]], "exceeds_max"],
    ["negative", [[W1, -1]], "negative"],
    ["after the Quote end", [["2026-03-02", 8]], "outside_quote"],
    ["before the Quote start", [["2025-12-29", 8]], "outside_quote"],
  ] as const)("refuses a cell %s", (_name, edits, reason) => {
    const result = edit(
      { startDate: W1, endDate: "2026-01-30" },
      edits.map(([d, a]) => [d, a])
    )
    expect(result).toMatchObject({ ok: false, errors: [{ reason }] })
  })

  it("refuses fractional units on an each-billed line", () => {
    const result = edit(
      { startDate: W1, endDate: "2026-01-30" },
      [[W1, "1.5"]],
      { billingUnit: "each" }
    )
    expect(result).toMatchObject({
      ok: false,
      errors: [{ periodStart: W1, reason: "not_whole" }],
    })
  })

  it("applies nothing when any cell of the gesture is refused", () => {
    const result = edit({ startDate: W1, endDate: "2026-01-30" }, [
      [W1, 40],
      [W2, 200],
      [W3, 999],
    ])
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors.map((e) => e.periodStart)).toEqual([W2, W3])
  })

  it("plans in month buckets on a Months Quote", () => {
    const result = applyAllocationEdits({
      timePeriod: "months",
      billingUnit: "hour",
      line: { startDate: "2026-01-15", endDate: "2026-03-31", allocations: [] },
      quote: { startDate: "2026-01-15", endDate: "2026-03-31" },
      edits: [
        { periodStart: "2026-02-10", amount: 160 },
        { periodStart: "2026-03-01", amount: 745 },
      ],
    })
    expect(result).toMatchObject({
      ok: false,
      errors: [{ periodStart: "2026-03-01", reason: "exceeds_max" }],
    })
  })
})

// Ported from quote-line-item-duration-change.test.ts (growLineItemEffort),
// plus the shrink half that keeps quantity = Σ Allocations.
describe("resizeAllocatedEffort", () => {
  const line = (amounts: number[], startDate = W1) => ({
    startDate,
    endDate: "2026-01-30",
    allocations: weeks([W1, W2, W3, W4].slice(0, amounts.length), amounts),
  })
  const resize = (
    quantity: number | string,
    l = line([40, 40, 40, 40]),
    overrides: Partial<{
      hoursPerDay: string
      quoteEnd: IsoDate
      timePeriod: "weeks" | "days"
    }> = {}
  ) =>
    resizeAllocatedEffort({
      timePeriod: overrides.timePeriod ?? "weeks",
      hoursPerDay: overrides.hoursPerDay ?? "8",
      quantity,
      line: l,
      quote: { startDate: W1, endDate: overrides.quoteEnd ?? "2026-03-31" },
    })

  it("appends full-load weeks when Effort grows (160 h → 240 h)", () => {
    const result = resize(240)
    expect(result.ok && cells(result.allocations)).toEqual({
      [W1]: 40,
      [W2]: 40,
      [W3]: 40,
      [W4]: 40,
      [W5]: 40,
      [W6]: 40,
    })
    expect(result).toMatchObject({
      quantity: "240.000",
      startDate: W1,
      endDate: "2026-02-15",
    })
  })

  it("keeps an existing shaped curve and only fills new weeks", () => {
    const result = resize(240, line([20, 40, 40, 60]))
    expect(result.ok && cells(result.allocations)).toEqual({
      [W1]: 20,
      [W2]: 40,
      [W3]: 40,
      [W4]: 60,
      [W5]: 40,
      [W6]: 40,
    })
  })

  it("makes the final new week partial", () => {
    const result = resize(220)
    expect(result.ok && cells(result.allocations)).toEqual({
      [W1]: 40,
      [W2]: 40,
      [W3]: 40,
      [W4]: 40,
      [W5]: 40,
      [W6]: 20,
    })
  })

  it("uses Hours Per Day for a full load", () => {
    const result = resize("235", line([40, 40, 40, 40]), { hoursPerDay: "7.5" })
    expect(result.ok && cells(result.allocations)).toEqual({
      [W1]: 40,
      [W2]: 40,
      [W3]: 40,
      [W4]: 40,
      [W5]: 37.5,
      [W6]: 37.5,
    })
  })

  it("plans a Days Quote in 5-day weeks", () => {
    const result = resize(200, line([40, 40, 40, 40]), { timePeriod: "days" })
    expect(result.ok && cells(result.allocations)[W5]).toBe(40)
  })

  it("starts from the line's first week when it has no Allocations", () => {
    const result = resize(60, {
      startDate: "2026-01-07",
      endDate: "2026-01-07",
      allocations: [],
    })
    expect(result.ok && cells(result.allocations)).toEqual({
      [W1]: 40,
      [W2]: 20,
    })
    expect(result).toMatchObject({
      startDate: "2026-01-07",
      endDate: "2026-01-18",
    })
  })

  it("trims Effort from the latest weeks when it shrinks", () => {
    const result = resize(100)
    expect(result.ok && cells(result.allocations)).toEqual({
      [W1]: 40,
      [W2]: 40,
      [W3]: 20,
    })
    expect(result).toMatchObject({ quantity: "100.000", endDate: "2026-01-25" })
  })

  it("shrinking to zero clears the Allocations", () => {
    const result = resize(0)
    expect(result).toMatchObject({
      ok: true,
      allocations: [],
      quantity: "0.000",
    })
  })

  it("an unchanged total changes nothing", () => {
    const result = resize(160)
    expect(result).toMatchObject({
      ok: true,
      quantity: "160.000",
      endDate: "2026-01-30",
    })
  })

  it("refuses growth past the Quote End Date", () => {
    expect(
      resize(240, line([40, 40, 40, 40]), { quoteEnd: "2026-02-06" })
    ).toMatchObject({
      ok: false,
      reason: "exceeds_quote_end",
    })
  })

  it("refuses negative Effort", () => {
    expect(resize(-1)).toMatchObject({ ok: false, reason: "negative" })
  })
})

// Ported from quote-allocation-utils.test.ts (diffAllocations). v1 keys rows by
// (Line Item, period start), so a shifted block writes only what changed.
describe("diffAllocations", () => {
  const diff = (before: AllocationInput[], after: AllocationInput[]) => {
    const result = diffAllocations("weeks", before, after)
    return { upserts: cells(result.upserts), deletes: result.deletes }
  }

  it("creates every Allocation the first time the planner is used", () => {
    expect(diff([], weeks([W1, W2, W3, W4], [20, 20, 20, 20]))).toEqual({
      upserts: { [W1]: 20, [W2]: 20, [W3]: 20, [W4]: 20 },
      deletes: [],
    })
  })

  it("updates changed amounts", () => {
    expect(diff(weeks([W1, W2], [20, 20]), weeks([W1, W2], [25, 20]))).toEqual({
      upserts: { [W1]: 25 },
      deletes: [],
    })
  })

  it("adds a new week and deletes a cleared one", () => {
    expect(
      diff(weeks([W1, W2, W3], [40, 40, 40]), weeks([W1, W2, W4], [40, 40, 40]))
    ).toEqual({
      upserts: { [W4]: 40 },
      deletes: [W3],
    })
  })

  it("produces nothing when nothing changed", () => {
    expect(
      diff(weeks([W1, W2], [20, 20]), weeks([W1, W2], ["20.000", "20"]))
    ).toEqual({ upserts: {}, deletes: [] })
  })

  it("a +1 week shift writes only the new week and deletes the vacated one", () => {
    expect(
      diff(
        weeks([W1, W2, W3, W4], [20, 20, 20, 20]),
        weeks([W2, W3, W4, W5], [20, 20, 20, 20])
      )
    ).toEqual({
      upserts: { [W5]: 20 },
      deletes: [W1],
    })
  })

  it("a shift with new amounts updates the overlapping weeks", () => {
    expect(
      diff(weeks([W1, W2, W3], [20, 20, 20]), weeks([W2, W3, W4], [30, 30, 30]))
    ).toEqual({
      upserts: { [W2]: 30, [W3]: 30, [W4]: 30 },
      deletes: [W1],
    })
  })

  it("a six-week +2 shift touches only the ends", () => {
    expect(
      diff(
        weeks([W1, W2, W3, W4, W5, W6], [20, 20, 20, 20, 20, 20]),
        weeks([W3, W4, W5, W6, W7, W8], [20, 20, 20, 20, 20, 20])
      )
    ).toEqual({ upserts: { [W7]: 20, [W8]: 20 }, deletes: [W1, W2] })
  })
})
