import { describe, expect, it } from "vitest"

import { Decimal } from "../money"
import {
  breakdownByItemType,
  bucketLabel,
  bucketsInRange,
  buildFinancials,
  endOfBucket,
  type FinancialLine,
  type FinancialsInput,
  overlapDays,
  startOfBucket,
} from "./index"

/**
 * Ported from the old portal's `financial-calculations.ts` behaviour
 * (calendar-day proration of revenue, cost and Resource Role quantity into
 * month / quarter / year buckets), then the v1 changes: the Quote-level
 * discount spread by revenue, exact sums, Allocations and FTE headcount.
 */

const line = (overrides: Partial<FinancialLine> = {}): FinancialLine => ({
  sourceKind: "catalog_item",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
  lineTotal: "0",
  unitCost: "0",
  quantity: "1",
  ...overrides,
})

const run = (overrides: Partial<FinancialsInput> = {}) =>
  buildFinancials({
    currency: "USD",
    granularity: "month",
    quote: { startDate: "2026-10-01", endDate: "2026-12-31" },
    lines: [],
    discountAmount: "0",
    hoursPerDay: "8",
    ...overrides,
  })

const sum = (values: string[]) =>
  values.reduce((a, v) => a.plus(v), new Decimal(0)).toFixed(4)

describe("buckets", () => {
  it.each([
    ["month", "2026-11-17", "2026-11-01", "2026-11-30", "Nov 2026"],
    ["month", "2028-02-10", "2028-02-01", "2028-02-29", "Feb 2028"],
    ["quarter", "2026-11-17", "2026-10-01", "2026-12-31", "Q4 2026"],
    ["quarter", "2027-02-01", "2027-01-01", "2027-03-31", "Q1 2027"],
    ["year", "2026-11-17", "2026-01-01", "2026-12-31", "2026"],
  ] as const)(
    "%s containing %s is %s…%s (%s)",
    (g, date, start, end, label) => {
      expect(startOfBucket(g, date)).toBe(start)
      expect(endOfBucket(g, start)).toBe(end)
      expect(bucketLabel(g, start)).toBe(label)
    }
  )

  it("covers the range, empty buckets included", () => {
    expect(
      bucketsInRange("month", "2026-10-15", "2027-01-02").map(
        (b) => b.periodStart
      )
    ).toEqual(["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"])
    expect(bucketsInRange("year", "2026-10-15", "2027-01-02")).toEqual([
      { periodStart: "2026-01-01", periodEnd: "2026-12-31" },
      { periodStart: "2027-01-01", periodEnd: "2027-12-31" },
    ])
  })

  it.each([
    ["2026-10-01", "2026-10-31", "2026-10-15", "2026-11-15", 17],
    ["2026-10-01", "2026-10-31", "2026-10-31", "2026-10-31", 1],
    ["2026-10-01", "2026-10-31", "2026-11-01", "2026-11-30", 0],
  ])("overlap of %s…%s and %s…%s is %i days", (a, b, c, d, days) => {
    expect(overlapDays(a, b, c, d)).toBe(days)
  })

  it("spans the Quote's dates even without lines", () => {
    const result = run()
    expect(result.buckets.map((b) => b.label)).toEqual([
      "Oct 2026",
      "Nov 2026",
      "Dec 2026",
    ])
    expect(result.buckets.every((b) => b.revenue === "0.0000")).toBe(true)
  })
})

describe("calendar-day proration (old portal behaviour)", () => {
  it("splits revenue and cost by days of overlap", () => {
    // Oct 1 – Nov 30: 31 + 30 days.
    const result = run({
      lines: [
        line({
          startDate: "2026-10-01",
          endDate: "2026-11-30",
          lineTotal: "6100",
          unitCost: "30.5",
          quantity: "100",
        }),
      ],
    })
    expect(result.buckets.map((b) => [b.label, b.revenue, b.cost])).toEqual([
      ["Oct 2026", "3100.0000", "1550.0000"],
      ["Nov 2026", "3000.0000", "1500.0000"],
      ["Dec 2026", "0.0000", "0.0000"],
    ])
  })

  it("puts a one-day line in its bucket", () => {
    const result = run({
      lines: [
        line({
          startDate: "2026-12-31",
          endDate: "2026-12-31",
          lineTotal: "50",
        }),
      ],
    })
    expect(result.buckets.map((b) => b.revenue)).toEqual([
      "0.0000",
      "0.0000",
      "50.0000",
    ])
  })

  it("aggregates by quarter and year", () => {
    const lines = [
      line({
        startDate: "2026-12-01",
        endDate: "2027-01-31",
        lineTotal: "620",
      }),
    ]
    const quote = { startDate: "2026-12-01", endDate: "2027-01-31" }
    expect(
      run({ granularity: "quarter", quote, lines }).buckets.map((b) => [
        b.label,
        b.revenue,
      ])
    ).toEqual([
      ["Q4 2026", "310.0000"],
      ["Q1 2027", "310.0000"],
    ])
    expect(
      run({ granularity: "year", quote, lines }).buckets.map((b) => b.label)
    ).toEqual(["2026", "2027"])
  })

  it("counts hours only for Resource Roles", () => {
    const result = run({
      lines: [
        line({ sourceKind: "catalog_item", quantity: "10", lineTotal: "10" }),
        line({ sourceKind: "catalog_item", quantity: "20", lineTotal: "10" }),
        line({
          sourceKind: "resource_role",
          startDate: "2026-10-01",
          endDate: "2026-11-30",
          quantity: "610",
          lineTotal: "61000",
        }),
      ],
    })
    expect(result.buckets.map((b) => b.hours)).toEqual([
      "310.000",
      "300.000",
      "0.000",
    ])
    expect(result.totals.hours).toBe("610.000")
  })

  it("skips a line that ends before it starts", () => {
    const result = run({
      lines: [
        line({
          startDate: "2026-11-02",
          endDate: "2026-11-01",
          lineTotal: "9",
        }),
      ],
    })
    expect(result.buckets.every((b) => b.grossRevenue === "0.0000")).toBe(true)
  })
})

describe("v1 rules", () => {
  it("adds up exactly to the totals (largest remainder in minor units)", () => {
    // 100 over three equal-length stretches of 30 days.
    const result = run({
      quote: { startDate: "2026-04-01", endDate: "2026-06-29" },
      lines: [
        line({
          startDate: "2026-04-01",
          endDate: "2026-06-29",
          lineTotal: "100",
          unitCost: "0.01",
          quantity: "1000",
        }),
      ],
    })
    const revenue = result.buckets.map((b) => b.revenue)
    // 30, 31 and 29 days: 33.33…, 34.44…, 32.22… → the leftover cent goes to May.
    expect(revenue).toEqual(["33.3300", "34.4500", "32.2200"])
    expect(sum(revenue)).toBe("100.0000")
    expect(sum(result.buckets.map((b) => b.cost))).toBe("10.0000")
    expect(result.totals).toMatchObject({
      grossRevenue: "100.0000",
      revenue: "100.0000",
      cost: "10.0000",
      margin: "90.0000",
    })
  })

  it("spreads the Quote Discount in proportion to revenue", () => {
    const result = run({
      lines: [
        // Oct: 3000, Nov: 1000 — nothing in Dec.
        line({
          startDate: "2026-10-01",
          endDate: "2026-10-31",
          lineTotal: "3000",
        }),
        line({
          startDate: "2026-11-01",
          endDate: "2026-11-30",
          lineTotal: "1000",
          unitCost: "200",
          quantity: "1",
        }),
      ],
      discountAmount: "400",
    })
    expect(
      result.buckets.map((b) => [
        b.grossRevenue,
        b.discount,
        b.revenue,
        b.margin,
      ])
    ).toEqual([
      ["3000.0000", "300.0000", "2700.0000", "2700.0000"],
      ["1000.0000", "100.0000", "900.0000", "700.0000"],
      ["0.0000", "0.0000", "0.0000", "0.0000"],
    ])
    expect(result.totals).toMatchObject({
      discount: "400.0000",
      revenue: "3600.0000",
      cost: "200.0000",
      margin: "3400.0000",
    })
  })

  it("keeps an uneven discount exact", () => {
    const result = run({
      lines: [
        line({
          startDate: "2026-10-01",
          endDate: "2026-12-31",
          lineTotal: "1000",
        }),
      ],
      discountAmount: "0.1",
    })
    expect(sum(result.buckets.map((b) => b.discount))).toBe("0.1000")
    expect(sum(result.buckets.map((b) => b.revenue))).toBe("999.9000")
  })

  it("follows a planner-managed line's Allocations", () => {
    const result = run({
      allocationPeriodType: "month",
      lines: [
        line({
          sourceKind: "resource_role",
          startDate: "2026-10-01",
          endDate: "2026-12-31",
          quantity: "200",
          unitCost: "100",
          lineTotal: "30000",
          allocations: [
            { periodStart: "2026-10-01", amount: "150" },
            { periodStart: "2026-12-01", amount: "50" },
          ],
        }),
      ],
    })
    expect(result.buckets.map((b) => [b.hours, b.revenue, b.cost])).toEqual([
      ["150.000", "22500.0000", "15000.0000"],
      ["0.000", "0.0000", "0.0000"],
      ["50.000", "7500.0000", "5000.0000"],
    ])
  })

  it("clips a weekly Allocation to the line's dates and prorates it by day", () => {
    // Week of Mon 2026-09-28 … Sun 10-04, line starts Thu 10-01: all 4 days in Oct.
    const result = run({
      allocationPeriodType: "week",
      lines: [
        line({
          sourceKind: "resource_role",
          startDate: "2026-10-01",
          endDate: "2026-10-04",
          quantity: "32",
          lineTotal: "3200",
          allocations: [{ periodStart: "2026-09-28", amount: "32" }],
        }),
      ],
    })
    expect(result.buckets[0]).toMatchObject({
      hours: "32.000",
      revenue: "3200.0000",
    })
  })

  it("measures headcount in full-time equivalents within the Quote's dates", () => {
    // October 2026 has 22 working days; 8 h a day → 176 h per FTE.
    const result = run({
      quote: { startDate: "2026-10-01", endDate: "2026-11-30" },
      lines: [
        line({
          sourceKind: "resource_role",
          startDate: "2026-10-01",
          endDate: "2026-10-31",
          quantity: "352",
        }),
        line({
          sourceKind: "resource_role",
          startDate: "2026-11-16",
          endDate: "2026-11-30",
          quantity: "88",
        }),
      ],
      hoursPerDay: "8",
    })
    // November: 21 working days in the Quote's dates (Nov 2 – Nov 30 Mon–Fri).
    expect(result.buckets.map((b) => [b.hours, b.headcount])).toEqual([
      ["352.000", "2.00"],
      ["88.000", "0.52"],
    ])
    expect(result.totals.peakHeadcount).toBe("2.00")
  })

  it("rounds to the currency's minor unit (JPY has none)", () => {
    const result = run({
      currency: "JPY",
      lines: [
        line({
          startDate: "2026-10-01",
          endDate: "2026-12-31",
          lineTotal: "1000",
        }),
      ],
    })
    const revenue = result.buckets.map((b) => b.revenue)
    expect(revenue.every((r) => r.endsWith(".0000"))).toBe(true)
    expect(sum(revenue)).toBe("1000.0000")
  })
})

describe("breakdownByItemType", () => {
  it("sums labour and each Catalog Type's revenue, cost and own margin", () => {
    const rows = breakdownByItemType(
      [
        {
          sourceKind: "resource_role",
          catalogTypeId: null,
          lineTotal: "600",
          unitCost: "4",
          quantity: "100",
        },
        {
          sourceKind: "resource_role",
          catalogTypeId: null,
          lineTotal: "200",
          unitCost: "1",
          quantity: "100",
        },
        {
          sourceKind: "catalog_item",
          catalogTypeId: "hardware",
          lineTotal: "200",
          unitCost: "150",
          quantity: "1",
        },
      ],
      ["hardware", "services"]
    )
    expect(rows).toEqual([
      {
        key: "resource_role",
        sourceKind: "resource_role",
        catalogTypeId: null,
        lineCount: 2,
        revenue: "800.0000",
        cost: "500.0000",
        margin: "300.0000",
        marginPct: "37.5000",
        shareOfSubtotal: "80.0000",
      },
      {
        key: "hardware",
        sourceKind: "catalog_item",
        catalogTypeId: "hardware",
        lineCount: 1,
        revenue: "200.0000",
        cost: "150.0000",
        margin: "50.0000",
        marginPct: "25.0000",
        shareOfSubtotal: "20.0000",
      },
      {
        key: "services",
        sourceKind: "catalog_item",
        catalogTypeId: "services",
        lineCount: 0,
        revenue: "0.0000",
        cost: "0.0000",
        margin: "0.0000",
        marginPct: "0.0000",
        shareOfSubtotal: "0.0000",
      },
    ])
  })

  it("appends a type the lines use that isn't listed", () => {
    const rows = breakdownByItemType(
      [
        {
          sourceKind: "catalog_item",
          catalogTypeId: "retired",
          lineTotal: "10",
          unitCost: "5",
          quantity: "1",
        },
      ],
      ["hardware"]
    )
    expect(rows.map((r) => [r.key, r.lineCount])).toEqual([
      ["resource_role", 0],
      ["hardware", 0],
      ["retired", 1],
    ])
  })
})
