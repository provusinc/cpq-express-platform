import { describe, expect, it } from "vitest"

import type { AllocationInput } from "../allocations"
import type { IsoDate } from "../dates"
import {
  changeLineItemStart,
  changeQuoteDates,
  changeQuoteWindow,
  type QuoteDateChange,
  type ScheduleLine,
  type ScheduleQuote,
} from "./index"

// 2026 anchors: Jan 5 is a Monday.
const MON_JAN5 = "2026-01-05"
const MON_JAN12 = "2026-01-12"
const WED_JAN14 = "2026-01-14"
const MON_JAN19 = "2026-01-19"
const WED_JAN21 = "2026-01-21"
const MON_JAN26 = "2026-01-26"
const FRI_JAN30 = "2026-01-30"
const FRI_FEB27 = "2026-02-27"

const weeks = (starts: IsoDate[], amounts: number[]): AllocationInput[] =>
  starts.map((periodStart, i) => ({ periodStart, amount: amounts[i] ?? 0 }))

const cells = (
  allocations: ReadonlyArray<{ periodStart: string; amount: string }>
) =>
  Object.fromEntries(allocations.map((a) => [a.periodStart, Number(a.amount)]))

const quoteOf = (overrides: Partial<ScheduleQuote> = {}): ScheduleQuote => ({
  startDate: MON_JAN5,
  endDate: FRI_JAN30,
  timePeriod: "weeks",
  hoursPerDay: 8,
  currency: "USD",
  discount: null,
  ...overrides,
})

/** Resource Role line, 4 weeks × 40 h = 160 h at $100, Jan 5–Jan 30. */
const roleLine = (overrides: Partial<ScheduleLine> = {}): ScheduleLine => ({
  id: "li-1",
  sourceKind: "resource_role",
  billingUnit: "hour",
  startDate: MON_JAN5,
  endDate: FRI_JAN30,
  quantity: 160,
  unitPrice: 100,
  unitCost: 80,
  allocations: weeks(
    [MON_JAN5, MON_JAN12, MON_JAN19, MON_JAN26],
    [40, 40, 40, 40]
  ),
  ...overrides,
})

const change = (
  lines: ScheduleLine[],
  c: QuoteDateChange,
  quote = quoteOf()
) => {
  const result = changeQuoteDates({ quote, lines, change: c })
  if (!result.ok) throw new Error(`refused: ${result.reason}`)
  return result
}

// Ported from portal quote-date-change.test.ts.
describe("changeQuoteDates — End Date moved in", () => {
  it("clamps overrunning lines, drops later Effort and caps the boundary week at working days × HPD", () => {
    const result = change([roleLine()], { field: "end", date: WED_JAN21 })
    const [line] = result.lines

    expect(result.endDate).toBe(WED_JAN21)
    expect(result.impact).toMatchObject({
      mode: "clamp",
      direction: "inward",
      requiresConfirmation: true,
    })
    // 40 + 40 + min(40, 3 working days × 8) = 104, last week dropped.
    expect(line?.quantity).toBe("104.000")
    expect(line?.startDate).toBe(MON_JAN5)
    expect(line?.endDate).toBe(WED_JAN21)
    expect(cells(line?.allocations ?? [])).toEqual({
      [MON_JAN5]: 40,
      [MON_JAN12]: 40,
      [MON_JAN19]: 24,
    })
  })

  it("never inflates a boundary week that holds less than the cap", () => {
    const item = roleLine({
      quantity: 136,
      allocations: weeks(
        [MON_JAN5, MON_JAN12, MON_JAN19, MON_JAN26],
        [40, 40, 16, 40]
      ),
    })
    const [line] = change([item], { field: "end", date: WED_JAN21 }).lines
    expect(cells(line?.allocations ?? [])).toEqual({
      [MON_JAN5]: 40,
      [MON_JAN12]: 40,
      [MON_JAN19]: 16,
    })
    expect(line?.quantity).toBe("96.000")
  })

  it("reports the old and new Total and counts", () => {
    const { impact } = change([roleLine()], { field: "end", date: WED_JAN21 })
    expect(impact).toMatchObject({
      oldTotal: "16000.0000",
      newTotal: "10400.0000",
      impactedCount: 1,
      clampedCount: 1,
      effortReducedCount: 1,
    })
    expect(impact.lines).toEqual([
      {
        id: "li-1",
        oldStartDate: MON_JAN5,
        newStartDate: MON_JAN5,
        oldEndDate: FRI_JAN30,
        newEndDate: WED_JAN21,
        oldQuantity: "160.000",
        newQuantity: "104.000",
        clamped: true,
        effortReduced: true,
      },
    ])
  })

  it("prices the Totals with the Quote Discount", () => {
    const { impact } = change(
      [roleLine()],
      { field: "end", date: WED_JAN21 },
      quoteOf({ discount: { kind: "percent", value: 10 } })
    )
    expect(impact.oldTotal).toBe("14400.0000")
    expect(impact.newTotal).toBe("9360.0000")
  })

  it("caps with the Organization's Hours Per Day", () => {
    const [line] = change(
      [roleLine()],
      { field: "end", date: WED_JAN21 },
      quoteOf({ hoursPerDay: "7.5" })
    ).lines
    expect(cells(line?.allocations ?? [])[MON_JAN19]).toBe(22.5)
  })

  it("caps a month bucket by its surviving working days", () => {
    const quote = quoteOf({
      timePeriod: "months",
      startDate: "2026-01-01",
      endDate: "2026-03-31",
    })
    const item = roleLine({
      startDate: "2026-01-01",
      endDate: "2026-03-31",
      quantity: 480,
      allocations: weeks(
        ["2026-01-01", "2026-02-01", "2026-03-01"],
        [160, 160, 160]
      ),
    })
    // Mar 1 2026 is a Sunday: Mar 2–6 and Mar 9–11 survive = 8 days = 64 h.
    const [line] = change(
      [item],
      { field: "end", date: "2026-03-11" },
      quote
    ).lines
    expect(cells(line?.allocations ?? [])).toEqual({
      "2026-01-01": 160,
      "2026-02-01": 160,
      "2026-03-01": 64,
    })
  })

  it("leaves lines that already end in time untouched", () => {
    const early = roleLine({
      id: "li-2",
      endDate: "2026-01-16",
      quantity: 80,
      allocations: weeks([MON_JAN5, MON_JAN12], [40, 40]),
    })
    const result = change([roleLine(), early], {
      field: "end",
      date: WED_JAN21,
    })
    expect(result.lines[1]).toMatchObject({
      changed: false,
      quantity: "80.000",
    })
    expect(result.impact.impactedCount).toBe(1)
  })

  it("moving the End Date out changes nothing else", () => {
    const result = change([roleLine()], { field: "end", date: "2026-02-28" })
    expect(result.endDate).toBe("2026-02-28")
    expect(result.lines[0]).toMatchObject({
      changed: false,
      quantity: "160.000",
      endDate: FRI_JAN30,
    })
    expect(result.impact).toMatchObject({
      direction: "outward",
      impactedCount: 0,
      requiresConfirmation: false,
      newTotal: "16000.0000",
    })
  })
})

describe("changeQuoteDates — Start Date with clamp", () => {
  it("clamps line starts up, drops earlier Effort and caps the boundary week", () => {
    const result = change([roleLine()], {
      field: "start",
      date: WED_JAN14,
      mode: "clamp",
    })
    const [line] = result.lines
    expect(result.startDate).toBe(WED_JAN14)
    expect(result.endDate).toBe(FRI_JAN30)
    expect(line?.startDate).toBe(WED_JAN14)
    expect(line?.endDate).toBe(FRI_JAN30)
    // First week dropped, boundary week capped at Wed–Fri = 24 h.
    expect(cells(line?.allocations ?? [])).toEqual({
      [MON_JAN12]: 24,
      [MON_JAN19]: 40,
      [MON_JAN26]: 40,
    })
    expect(line?.quantity).toBe("104.000")
  })

  it("moving the start earlier changes nothing else", () => {
    const result = change([roleLine()], {
      field: "start",
      date: "2026-01-01",
      mode: "clamp",
    })
    expect(result.startDate).toBe("2026-01-01")
    expect(result.lines[0]?.changed).toBe(false)
    expect(result.impact).toMatchObject({
      direction: "outward",
      requiresConfirmation: false,
    })
  })
})

describe("changeQuoteDates — Quote Shift (the default for a start move)", () => {
  it("slides the Quote, its lines and Allocations by the same delta, keeping all Effort", () => {
    const result = change([roleLine()], { field: "start", date: MON_JAN12 })
    const [line] = result.lines

    expect(result.impact.mode).toBe("shift")
    expect(result.startDate).toBe(MON_JAN12)
    expect(result.endDate).toBe("2026-02-06")
    expect(line?.startDate).toBe(MON_JAN12)
    expect(line?.endDate).toBe("2026-02-06")
    expect(line?.quantity).toBe("160.000")
    expect(cells(line?.allocations ?? [])).toEqual({
      [MON_JAN12]: 40,
      [MON_JAN19]: 40,
      [MON_JAN26]: 40,
      "2026-02-02": 40,
    })
    expect(result.impact).toMatchObject({
      oldTotal: "16000.0000",
      newTotal: "16000.0000",
      impactedCount: 1,
      clampedCount: 0,
      effortReducedCount: 0,
      requiresConfirmation: true,
    })
  })

  it("shifts earlier with a negative delta", () => {
    const result = change([roleLine()], { field: "start", date: "2025-12-29" })
    expect(result.endDate).toBe("2026-01-23")
    expect(result.lines[0]).toMatchObject({
      startDate: "2025-12-29",
      endDate: "2026-01-23",
      quantity: "160.000",
    })
    expect(result.lines[0]?.allocations[0]?.periodStart).toBe("2025-12-29")
  })

  it("is accepted even when the same move would be refused as a clamp", () => {
    const item = roleLine({ endDate: MON_JAN19 })
    const clamp = changeQuoteDates({
      quote: quoteOf(),
      lines: [item],
      change: { field: "start", date: MON_JAN26, mode: "clamp" },
    })
    expect(clamp).toMatchObject({ ok: false, reason: "line_item_outside" })

    const shift = change([item], { field: "start", date: MON_JAN26 })
    expect(shift.lines[0]?.quantity).toBe("160.000")
  })

  it("moves Allocations only by whole buckets", () => {
    // +2 days keeps every line in the same weeks.
    const result = change([roleLine()], { field: "start", date: "2026-01-07" })
    expect(result.lines[0]?.startDate).toBe("2026-01-07")
    expect(result.lines[0]?.endDate).toBe("2026-02-01")
    expect(cells(result.lines[0]?.allocations ?? [])).toEqual({
      [MON_JAN5]: 40,
      [MON_JAN12]: 40,
      [MON_JAN19]: 40,
      [MON_JAN26]: 40,
    })
  })

  it("moves month Allocations by the months their line's start moved", () => {
    const quote = quoteOf({
      timePeriod: "months",
      startDate: "2026-01-20",
      endDate: "2026-03-31",
    })
    const item = roleLine({
      startDate: "2026-01-20",
      endDate: "2026-03-31",
      allocations: weeks(
        ["2026-01-01", "2026-02-01", "2026-03-01"],
        [40, 160, 160]
      ),
    })
    const result = change([item], { field: "start", date: "2026-02-02" }, quote)
    expect(cells(result.lines[0]?.allocations ?? [])).toEqual({
      "2026-02-01": 40,
      "2026-03-01": 160,
      "2026-04-01": 160,
    })
  })

  it("a no-op move changes nothing", () => {
    const result = change([roleLine()], { field: "start", date: MON_JAN5 })
    expect(result.impact).toMatchObject({ direction: "none", impactedCount: 0 })
  })
})

describe("changeQuoteDates — lines that aren't planner-managed", () => {
  it.each([
    [
      "a Product",
      roleLine({
        sourceKind: "catalog_item",
        billingUnit: "each",
        quantity: 100,
        allocations: [],
      }),
    ],
    [
      "an hourly Add-on",
      roleLine({ sourceKind: "catalog_item", quantity: 100, allocations: [] }),
    ],
    [
      "a Resource Role line without Allocations",
      roleLine({ quantity: 100, allocations: [] }),
    ],
  ])("%s only has its date clamped", (_name, item) => {
    const result = change([item], { field: "end", date: WED_JAN21 })
    expect(result.lines[0]).toMatchObject({
      endDate: WED_JAN21,
      quantity: "100.000",
      changed: true,
    })
    expect(result.impact).toMatchObject({
      clampedCount: 1,
      effortReducedCount: 0,
    })
  })
})

describe("changeQuoteDates — refusals", () => {
  it.each([
    [
      "an End Date before the latest line start",
      [roleLine({ startDate: MON_JAN12 })],
      { field: "end", date: MON_JAN5 },
      quoteOf({ startDate: "2026-01-01" }),
      "line_item_outside",
    ],
    [
      "a clamped Start Date after the earliest line end",
      [roleLine({ endDate: MON_JAN19 })],
      { field: "start", date: MON_JAN26, mode: "clamp" },
      quoteOf(),
      "line_item_outside",
    ],
    [
      "an End Date before the Quote Start Date",
      [],
      { field: "end", date: "2026-01-04" },
      quoteOf(),
      "end_before_start",
    ],
    [
      "a clamped Start Date after the Quote End Date",
      [],
      { field: "start", date: "2026-02-02", mode: "clamp" },
      quoteOf(),
      "start_after_end",
    ],
  ] as const)("refuses %s", (_name, lines, c, quote, reason) => {
    const result = changeQuoteDates({ quote, lines: [...lines], change: c })
    expect(result).toMatchObject({ ok: false, reason })
    if (!result.ok) expect(result.message).not.toBe("")
  })

  it("names the blocking line", () => {
    const result = changeQuoteDates({
      quote: quoteOf({ startDate: "2026-01-01" }),
      lines: [
        roleLine({ id: "a" }),
        roleLine({ id: "b", startDate: MON_JAN12 }),
      ],
      change: { field: "end", date: MON_JAN5 },
    })
    expect(result).toMatchObject({ ok: false, lineItemId: "b" })
  })
})

// Ported from portal quote-line-item-date-change.test.ts (lift-and-shift).
describe("changeLineItemStart", () => {
  const move = (line: ScheduleLine, startDate: IsoDate, quote = quoteOf()) => {
    const result = changeLineItemStart({ quote, line, startDate })
    if (!result.ok) throw new Error(`refused: ${result.reason}`)
    return result
  }

  it.each([
    ["before the Quote Start Date", "2026-01-01", "before_quote_start"],
    ["after the Quote End Date", "2026-02-05", "after_quote_end"],
  ] as const)("refuses a start %s", (_name, startDate, reason) => {
    const result = changeLineItemStart({
      quote: quoteOf(),
      line: roleLine(),
      startDate,
    })
    expect(result).toMatchObject({ ok: false, reason })
  })

  it("allows moving the start onto the old end date — the end lifts with it", () => {
    const result = move(roleLine({ endDate: MON_JAN19 }), MON_JAN19)
    expect(result.line.startDate).toBe(MON_JAN19)
  })

  it("moving later trims only Effort pushed past the Quote End Date", () => {
    // +2 weeks → Jan 19, Jan 26, Feb 2, Feb 9; the Quote ends Jan 30.
    const result = move(roleLine(), MON_JAN19)
    expect(cells(result.line.allocations)).toEqual({
      [MON_JAN19]: 40,
      [MON_JAN26]: 40,
    })
    expect(result.line.quantity).toBe("80.000")
    expect(result.line.endDate).toBe(FRI_JAN30)
    expect(result.impact).toMatchObject({
      direction: "later",
      effortReduced: true,
      clamped: true,
      requiresConfirmation: true,
    })
  })

  it("moving earlier shifts the block back and keeps Effort", () => {
    const item = roleLine({
      startDate: MON_JAN12,
      quantity: 120,
      allocations: weeks([MON_JAN12, MON_JAN19, MON_JAN26], [40, 40, 40]),
    })
    const result = move(item, MON_JAN5)
    expect(Object.keys(cells(result.line.allocations))).toEqual([
      MON_JAN5,
      MON_JAN12,
      MON_JAN19,
    ])
    expect(result.line).toMatchObject({
      quantity: "120.000",
      endDate: "2026-01-23",
    })
    expect(result.impact).toMatchObject({
      direction: "earlier",
      effortReduced: false,
      requiresConfirmation: false,
    })
  })

  it("moving later within the Quote keeps shape and Effort", () => {
    const item = roleLine({
      endDate: "2026-01-16",
      quantity: 80,
      allocations: weeks([MON_JAN5, MON_JAN12], [24, 56]),
    })
    const result = move(item, MON_JAN19, quoteOf({ endDate: FRI_FEB27 }))
    expect(cells(result.line.allocations)).toEqual({
      [MON_JAN19]: 24,
      [MON_JAN26]: 56,
    })
    expect(result.line).toMatchObject({
      quantity: "80.000",
      endDate: FRI_JAN30,
    })
    expect(result.impact.requiresConfirmation).toBe(false)
  })

  it("trims progressively as the block is pushed further", () => {
    const item = roleLine({
      endDate: "2026-01-23",
      quantity: 120,
      allocations: weeks([MON_JAN5, MON_JAN12, MON_JAN19], [40, 40, 40]),
    })
    const plusOne = move(item, MON_JAN12)
    expect(Object.keys(cells(plusOne.line.allocations))).toEqual([
      MON_JAN12,
      MON_JAN19,
      MON_JAN26,
    ])
    expect(plusOne.line.quantity).toBe("120.000")
    expect(plusOne.impact.requiresConfirmation).toBe(false)

    const plusTwo = move(item, MON_JAN19)
    expect(Object.keys(cells(plusTwo.line.allocations))).toEqual([
      MON_JAN19,
      MON_JAN26,
    ])
    expect(plusTwo.line.quantity).toBe("80.000")
    expect(plusTwo.impact).toMatchObject({
      effortReduced: true,
      requiresConfirmation: true,
    })
  })

  it("a move within the same week keeps the Allocations where they are", () => {
    const result = move(roleLine(), "2026-01-07")
    expect(result.line.startDate).toBe("2026-01-07")
    expect(result.line.allocations[0]?.periodStart).toBe(MON_JAN5)
    expect(result.line.quantity).toBe("160.000")
  })

  it("a line that isn't planner-managed moves its dates and keeps its quantity", () => {
    const product = roleLine({
      sourceKind: "catalog_item",
      billingUnit: "each",
      quantity: 5,
      allocations: [],
    })
    const result = move(product, MON_JAN12)
    expect(result.line).toMatchObject({
      startDate: MON_JAN12,
      endDate: FRI_JAN30,
      quantity: "5.000",
      changed: true,
    })
    expect(result.impact).toMatchObject({
      clamped: true,
      requiresConfirmation: false,
    })
  })

  it("an unchanged start is a no-op", () => {
    const result = move(roleLine(), MON_JAN5)
    expect(result.line.changed).toBe(false)
    expect(result.impact.direction).toBe("same")
  })
})

describe("changeQuoteWindow", () => {
  it("shifts by default, keeping Effort, and lets the end move too", () => {
    const result = changeQuoteWindow({
      quote: quoteOf(),
      lines: [roleLine()],
      startDate: MON_JAN12,
      endDate: "2026-02-06",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.startDate).toBe(MON_JAN12)
    expect(result.endDate).toBe("2026-02-06")
    expect(result.impact).toMatchObject({
      mode: "shift",
      impactedCount: 1,
      clampedCount: 0,
      effortReducedCount: 0,
      oldTotal: "16000.0000",
      newTotal: "16000.0000",
    })
    expect(cells(result.lines[0]!.allocations)).toEqual({
      [MON_JAN12]: 40,
      [MON_JAN19]: 40,
      [MON_JAN26]: 40,
      "2026-02-02": 40,
    })
  })

  it("shifts, then clamps an end pulled in below the shifted end", () => {
    const result = changeQuoteWindow({
      quote: quoteOf(),
      lines: [roleLine()],
      startDate: MON_JAN12,
      endDate: FRI_JAN30,
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.impact).toMatchObject({
      clampedCount: 1,
      effortReducedCount: 1,
      oldTotal: "16000.0000",
      newTotal: "12000.0000",
    })
    expect(result.impact.steps.map((s) => s.field)).toEqual(["start", "end"])
  })

  it("clamps the start when asked, and outward moves change nothing", () => {
    const clamp = changeQuoteWindow({
      quote: quoteOf(),
      lines: [roleLine()],
      startDate: MON_JAN12,
      endDate: FRI_JAN30,
      mode: "clamp",
    })
    if (!clamp.ok) throw new Error(clamp.message)
    expect(clamp.lines[0]).toMatchObject({
      startDate: MON_JAN12,
      quantity: "120.000",
    })
    const outward = changeQuoteWindow({
      quote: quoteOf(),
      lines: [roleLine()],
      startDate: "2025-12-29",
      endDate: FRI_FEB27,
      mode: "clamp",
    })
    if (!outward.ok) throw new Error(outward.message)
    expect(outward.impact.impactedCount).toBe(0)
    expect(outward.lines[0]!.changed).toBe(false)
  })

  it("passes refusals through", () => {
    expect(
      changeQuoteWindow({
        quote: quoteOf(),
        lines: [roleLine()],
        startDate: MON_JAN5,
        endDate: "2026-01-01",
      })
    ).toMatchObject({ ok: false, reason: "end_before_start" })
  })
})
