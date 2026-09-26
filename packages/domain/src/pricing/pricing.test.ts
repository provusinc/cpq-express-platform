import { describe, expect, it } from "vitest"

import type { TimePeriod } from "../enums"
import {
  defaultLineItemQuantity,
  hoursPerTimePeriod,
  priceQuote,
  type PricingLine,
  type QuoteDiscount,
  showsQuantity,
} from "./index"

const line = (
  unitPrice: string,
  quantity: string,
  unitCost = "0"
): PricingLine => ({ unitPrice, quantity, unitCost })

// Ported from portal quote-utils.test.ts (getHoursForTimePeriod). v1 applies
// the Organization's Hours Per Day everywhere (no hard-coded 8/40/160/480).
describe("hoursPerTimePeriod", () => {
  it.each([
    ["days", 8, "8.000"],
    ["weeks", 8, "40.000"],
    ["months", 8, "160.000"],
    ["quarters", 8, "480.000"],
    ["days", 9, "9.000"],
    ["weeks", 9, "45.000"],
    ["months", 9, "180.000"],
    ["quarters", 9, "540.000"],
    ["days", "7.5", "7.500"],
    ["weeks", "7.5", "37.500"],
    ["months", "7.5", "150.000"],
    ["quarters", "7.5", "450.000"],
  ] as const)("%s at %s HPD → %s hours", (timePeriod, hpd, expected) => {
    expect(hoursPerTimePeriod(timePeriod, hpd)).toBe(expected)
  })
})

// Ported from portal quote-utils.test.ts (convertToQuoteLineItem – default quantity).
describe("defaultLineItemQuantity", () => {
  it.each([
    ["hour", "days", "8.000"],
    ["hour", "weeks", "40.000"],
    ["hour", "months", "160.000"],
    ["hour", "quarters", "480.000"],
    ["each", "days", "1.000"],
    ["each", "months", "1.000"],
    ["each", "quarters", "1.000"],
  ] as const)("%s line on a %s Quote → %s", (billingUnit, timePeriod, qty) => {
    expect(
      defaultLineItemQuantity({
        billingUnit,
        timePeriod: timePeriod as TimePeriod,
        hoursPerDay: 8,
      })
    ).toBe(qty)
  })

  it("uses the Organization's Hours Per Day", () => {
    expect(
      defaultLineItemQuantity({
        billingUnit: "hour",
        timePeriod: "weeks",
        hoursPerDay: "7.5",
      })
    ).toBe("37.500")
  })
})

describe("priceQuote – line totals", () => {
  it.each([
    // Ported: hour line total = price × hours; each line = price × units.
    ["100", "160", "USD", "16000.0000"],
    ["1500", "3", "USD", "4500.0000"],
    // Rounded to the currency minor unit, half-up.
    ["33.333", "3", "USD", "100.0000"],
    ["0.335", "1", "USD", "0.3400"],
    ["10.005", "1", "USD", "10.0100"],
    ["99.5", "1", "JPY", "100.0000"],
    ["1.0005", "1", "KWD", "1.0010"],
    ["100", "0", "USD", "0.0000"],
    ["125.50", "37.5", "USD", "4706.2500"],
  ])("%s × %s in %s → %s", (unitPrice, quantity, currency, expected) => {
    const result = priceQuote({ currency, lines: [line(unitPrice, quantity)] })
    expect(result.lines[0]?.lineTotal).toBe(expected)
  })

  it("Subtotal is the exact sum of the rounded line totals", () => {
    // Each line rounds 0.335 → 0.34, so the Subtotal is 1.02, not round(1.005).
    const result = priceQuote({
      currency: "USD",
      lines: [line("0.335", "1"), line("0.335", "1"), line("0.335", "1")],
    })
    expect(result.lines.map((l) => l.lineTotal)).toEqual([
      "0.3400",
      "0.3400",
      "0.3400",
    ])
    expect(result.subtotal).toBe("1.0200")
  })

  it("an empty Quote prices to zero everywhere", () => {
    expect(priceQuote({ currency: "USD", lines: [] })).toEqual({
      lines: [],
      subtotal: "0.0000",
      discountAmount: "0.0000",
      total: "0.0000",
      cost: "0.0000",
      margin: "0.0000",
      marginPct: "0.0000",
    })
  })

  it("is not fooled by float-style inputs", () => {
    const result = priceQuote({
      currency: "USD",
      lines: [line("0.1", "1"), line("0.2", "1")],
    })
    expect(result.subtotal).toBe("0.3000")
  })
})

// Ported from portal quote-utils.test.ts (margin percentage) and
// quote-calculations.ts. Margin is before the Quote Discount at line level.
describe("priceQuote – line margins", () => {
  it.each([
    ["100", "80", "160", "3200.0000", "20.0000"],
    ["200", "120", "1", "80.0000", "40.0000"],
    ["200", "0", "1", "200.0000", "100.0000"],
    ["100", "150", "1", "-50.0000", "-50.0000"],
    ["0", "10", "1", "-10.0000", "0.0000"],
  ])(
    "price %s cost %s qty %s → margin %s (%s %%)",
    (unitPrice, unitCost, quantity, margin, pct) => {
      const [priced] = priceQuote({
        currency: "USD",
        lines: [line(unitPrice, quantity, unitCost)],
      }).lines
      expect(priced?.lineMargin).toBe(margin)
      expect(priced?.lineMarginPct).toBe(pct)
    }
  )

  it("hourly cost is per hour, never multiplied by hours per period", () => {
    // Old bug: cost 80 × 160 h/month made margin −12 700 %.
    const [priced] = priceQuote({
      currency: "USD",
      lines: [line("100", "160", "80")],
    }).lines
    expect(priced?.lineCost).toBe("12800.0000")
    expect(priced?.lineMarginPct).toBe("20.0000")
  })

  it("line margin ignores the Quote Discount", () => {
    const [priced] = priceQuote({
      currency: "USD",
      lines: [line("100", "10", "50")],
      discount: { kind: "percent", value: "50" },
    }).lines
    expect(priced?.lineMarginPct).toBe("50.0000")
  })
})

describe("priceQuote – Quote Discount", () => {
  const lines = [line("100", "160", "80")] // Subtotal 16 000, cost 12 800

  it.each<[string, QuoteDiscount | null, string, string]>([
    ["no discount", null, "0.0000", "16000.0000"],
    // Ported: the old line-level 10 % case, now applied at Quote level.
    ["10 % off", { kind: "percent", value: "10" }, "1600.0000", "14400.0000"],
    [
      "12.5 % off",
      { kind: "percent", value: "12.5" },
      "2000.0000",
      "14000.0000",
    ],
    [
      "$5,000 off",
      { kind: "amount", value: "5000" },
      "5000.0000",
      "11000.0000",
    ],
    ["0 % off", { kind: "percent", value: "0" }, "0.0000", "16000.0000"],
    ["100 % off", { kind: "percent", value: "100" }, "16000.0000", "0.0000"],
    [
      "150 % off is held to the Subtotal",
      { kind: "percent", value: "150" },
      "16000.0000",
      "0.0000",
    ],
    [
      "an amount above the Subtotal is held to it",
      { kind: "amount", value: "20000" },
      "16000.0000",
      "0.0000",
    ],
    [
      "a negative amount is ignored",
      { kind: "amount", value: "-10" },
      "0.0000",
      "16000.0000",
    ],
  ])("%s", (_name, discount, discountAmount, total) => {
    const result = priceQuote({ currency: "USD", lines, discount })
    expect(result.subtotal).toBe("16000.0000")
    expect(result.discountAmount).toBe(discountAmount)
    expect(result.total).toBe(total)
  })

  it("rounds the derived discount amount to the minor unit", () => {
    // 33.335 % of 100 = 33.335 → 33.34
    const result = priceQuote({
      currency: "USD",
      lines: [line("100", "1")],
      discount: { kind: "percent", value: "33.335" },
    })
    expect(result.discountAmount).toBe("33.3400")
    expect(result.total).toBe("66.6600")
  })

  it("rounds an entered amount to the minor unit", () => {
    const result = priceQuote({
      currency: "JPY",
      lines: [line("1000", "1")],
      discount: { kind: "amount", value: "99.5" },
    })
    expect(result.discountAmount).toBe("100.0000")
    expect(result.total).toBe("900.0000")
  })

  it("keeps whichever form was entered authoritative as lines change", () => {
    const percent: QuoteDiscount = { kind: "percent", value: "10" }
    const amount: QuoteDiscount = { kind: "amount", value: "500" }
    const before = [line("100", "10")] // 1 000
    const after = [line("100", "10"), line("100", "20")] // 3 000

    expect(
      priceQuote({ currency: "USD", lines: before, discount: percent })
        .discountAmount
    ).toBe("100.0000")
    expect(
      priceQuote({ currency: "USD", lines: after, discount: percent })
        .discountAmount
    ).toBe("300.0000")
    expect(
      priceQuote({ currency: "USD", lines: before, discount: amount })
        .discountAmount
    ).toBe("500.0000")
    expect(
      priceQuote({ currency: "USD", lines: after, discount: amount })
        .discountAmount
    ).toBe("500.0000")
  })

  it("floors Total at 0 even with a negative Subtotal", () => {
    const result = priceQuote({
      currency: "USD",
      lines: [line("-50", "1")],
      discount: { kind: "amount", value: "10" },
    })
    expect(result.subtotal).toBe("-50.0000")
    expect(result.discountAmount).toBe("0.0000")
    expect(result.total).toBe("0.0000")
  })
})

describe("priceQuote – cost and Margin", () => {
  it("Cost = Σ unit cost × quantity; Margin = Total − cost", () => {
    const result = priceQuote({
      currency: "USD",
      lines: [line("100", "160", "80"), line("1500", "2", "1000")],
      discount: { kind: "amount", value: "1000" },
    })
    expect(result.subtotal).toBe("19000.0000")
    expect(result.total).toBe("18000.0000")
    expect(result.cost).toBe("14800.0000")
    expect(result.margin).toBe("3200.0000")
    expect(result.marginPct).toBe("17.7778")
  })

  it("Margin % is 0 when Total is 0", () => {
    const result = priceQuote({
      currency: "USD",
      lines: [line("100", "1", "40")],
      discount: { kind: "percent", value: "100" },
    })
    expect(result.total).toBe("0.0000")
    expect(result.margin).toBe("-40.0000")
    expect(result.marginPct).toBe("0.0000")
  })

  it("keeps cost at storage scale without rounding to cents", () => {
    const result = priceQuote({
      currency: "USD",
      lines: [line("10", "3", "0.3333")],
    })
    expect(result.cost).toBe("0.9999")
  })

  it("clamps an extreme Margin % to fit numeric(7,4)", () => {
    const result = priceQuote({
      currency: "USD",
      lines: [line("1", "1", "1000")],
    })
    expect(result.margin).toBe("-999.0000")
    expect(result.marginPct).toBe("-999.9999")
    expect(result.lines[0]?.lineMarginPct).toBe("-999.9999")
  })
})

describe("showsQuantity", () => {
  it.each([
    ["each", "1.000", false],
    ["each", "1", false],
    ["each", 1, false],
    ["each", "2.000", true],
    ["each", "0.000", true],
    ["each", "1.500", true],
    ["hour", "1.000", true],
    ["hour", "40.000", true],
  ] as const)("%s × %s → %s", (billingUnit, quantity, expected) => {
    expect(showsQuantity({ billingUnit, quantity })).toBe(expected)
  })
})
