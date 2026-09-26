import { Decimal } from "decimal.js"

import type { BillingUnit, DiscountKind, TimePeriod } from "../enums"
import {
  type DecimalInput,
  roundToMinorUnit,
  toMoneyString,
  toPercentString,
  toQuantityString,
} from "../money"

/**
 * Pricing engine (ADR-0002). Runs in the browser for live editing and on the
 * server, which recomputes and persists totals after every command and ignores
 * totals sent by the client. Outputs follow the money module's string
 * convention (money 4 dp, percentages 4 dp, quantities 3 dp).
 */

/** The billable default when an Organization hasn't set Hours Per Day. */
export const DEFAULT_HOURS_PER_DAY = 8

/** Working days in each Time Period: day 1, week 5, month 20, quarter 60. */
const WORKING_DAYS_PER_TIME_PERIOD: Record<TimePeriod, number> = {
  days: 1,
  weeks: 5,
  months: 20,
  quarters: 60,
}

/**
 * Hours in one Time Period from the Organization's Hours Per Day:
 * day = HPD, week = 5 × HPD, month = 20 × HPD, quarter = 60 × HPD.
 */
export function hoursPerTimePeriod(
  timePeriod: TimePeriod,
  hoursPerDay: DecimalInput
): string {
  return toQuantityString(
    new Decimal(hoursPerDay).times(WORKING_DAYS_PER_TIME_PERIOD[timePeriod])
  )
}

/**
 * Quantity a new Line Item starts with: one Time Period of hours for an
 * hourly line (e.g. 40 h on a Weeks Quote at 8 HPD), otherwise 1.
 */
export function defaultLineItemQuantity(input: {
  billingUnit: BillingUnit
  timePeriod: TimePeriod
  hoursPerDay: DecimalInput
}): string {
  return input.billingUnit === "hour"
    ? hoursPerTimePeriod(input.timePeriod, input.hoursPerDay)
    : toQuantityString(1)
}

/**
 * Whether a Line Item's quantity is shown (display only; pricing is
 * unchanged). A flat fee is Each with quantity 1, so its quantity is hidden
 * and its unit price reads as the line's amount. Hour lines always show it.
 */
export function showsQuantity(line: {
  billingUnit: BillingUnit
  quantity: DecimalInput
}): boolean {
  return line.billingUnit !== "each" || !new Decimal(line.quantity).equals(1)
}

/** The Quote Discount as entered. `value` is a percent (10 = 10 %) or an amount. */
export interface QuoteDiscount {
  kind: DiscountKind
  value: DecimalInput
}

export interface PricingLine {
  unitPrice: DecimalInput
  unitCost: DecimalInput
  quantity: DecimalInput
}

export interface PriceQuoteInput {
  /** ISO 4217 code; line totals and the discount round to its minor unit. */
  currency: string
  lines: readonly PricingLine[]
  /** `null` / omitted for no Quote Discount. */
  discount?: QuoteDiscount | null
}

export interface PricedLine {
  /** unit price × quantity, rounded to the currency's minor unit. */
  lineTotal: string
  /** unit cost × quantity (unrounded beyond storage scale). */
  lineCost: string
  /** lineTotal − lineCost: the line's own margin, before the Quote Discount. */
  lineMargin: string
  /** lineMargin / lineTotal × 100, or 0 when lineTotal is 0. */
  lineMarginPct: string
}

export interface QuoteTotals {
  /** Same order as the input lines. */
  lines: PricedLine[]
  /** Σ line totals. */
  subtotal: string
  /** Derived from the entered discount, rounded, within [0, Subtotal]. */
  discountAmount: string
  /** Subtotal − discountAmount, never negative. */
  total: string
  /** Σ unit cost × quantity. */
  cost: string
  /** Total − cost. */
  margin: string
  /** margin / Total × 100, or 0 when Total is 0. */
  marginPct: string
}

/** `numeric(7,4)` bounds, so a tiny Total with a large cost still stores. */
const PERCENT_MIN = new Decimal("-999.9999")
const PERCENT_MAX = new Decimal("999.9999")

function percentOf(part: Decimal, whole: Decimal): string {
  if (whole.isZero()) return toPercentString(0)
  const pct = Decimal.min(
    PERCENT_MAX,
    Decimal.max(PERCENT_MIN, part.dividedBy(whole).times(100))
  )
  return toPercentString(pct)
}

/**
 * Price a Quote: per-line totals and margins, Subtotal, Quote Discount,
 * Total, cost and Margin. Line Items carry no discount of their own.
 *
 * - A percent discount is `Subtotal × value / 100`, rounded; an amount
 *   discount is the amount, rounded. Either is held within [0, Subtotal], so
 *   Subtotal − discountAmount = Total reconciles. Total is floored at 0 (only
 *   reachable with a negative Subtotal).
 * - Margin % values are clamped to ±999.9999 to fit `numeric(7,4)`.
 */
export function priceQuote(input: PriceQuoteInput): QuoteTotals {
  const { currency } = input
  let subtotal = new Decimal(0)
  let cost = new Decimal(0)

  const lines = input.lines.map((line): PricedLine => {
    const quantity = new Decimal(line.quantity)
    const lineTotal = roundToMinorUnit(
      new Decimal(line.unitPrice).times(quantity),
      currency
    )
    const lineCost = new Decimal(line.unitCost).times(quantity)
    const lineMargin = lineTotal.minus(lineCost)
    subtotal = subtotal.plus(lineTotal)
    cost = cost.plus(lineCost)
    return {
      lineTotal: toMoneyString(lineTotal),
      lineCost: toMoneyString(lineCost),
      lineMargin: toMoneyString(lineMargin),
      lineMarginPct: percentOf(lineMargin, lineTotal),
    }
  })

  const discountAmount = computeDiscountAmount(
    subtotal,
    input.discount,
    currency
  )
  const total = Decimal.max(0, subtotal.minus(discountAmount))
  const margin = total.minus(cost)

  return {
    lines,
    subtotal: toMoneyString(subtotal),
    discountAmount: toMoneyString(discountAmount),
    total: toMoneyString(total),
    cost: toMoneyString(cost),
    margin: toMoneyString(margin),
    marginPct: percentOf(margin, total),
  }
}

function computeDiscountAmount(
  subtotal: Decimal,
  discount: QuoteDiscount | null | undefined,
  currency: string
): Decimal {
  if (!discount) return new Decimal(0)
  const raw =
    discount.kind === "percent"
      ? subtotal.times(discount.value).dividedBy(100)
      : new Decimal(discount.value)
  const rounded = roundToMinorUnit(raw, currency)
  const ceiling = Decimal.max(subtotal, 0)
  return Decimal.min(ceiling, Decimal.max(0, rounded))
}
