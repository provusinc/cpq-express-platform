import { Decimal } from "decimal.js"

import {
  addDays,
  compareDates,
  countWorkingDays,
  daysBetween,
  endOfPeriod,
  maxDate,
  minDate,
  type IsoDate,
} from "../dates"
import { distributeWholeUnits } from "../effort"
import type { PeriodType, SourceKind } from "../enums"
import {
  currencyMinorUnit,
  type DecimalInput,
  toMoneyString,
  toPercentString,
  toQuantityString,
} from "../money"

/**
 * A Quote's financial profile over time (the Financials tab) and its mix by
 * item type (the Summary's breakdown). Ported from the old portal's
 * `financial-calculations.ts` and adapted to v1's rules:
 *
 * - **Calendar-day proration.** A line's revenue (its `lineTotal`), cost
 *   (unit cost × quantity) and, for Resource Roles, hours (its quantity)
 *   spread over the buckets its dates overlap, in proportion to the
 *   calendar days of overlap (both ends inclusive), as before.
 * - **Allocations first.** A planner-managed line (with Allocations) spreads
 *   each Allocation's share (amount / Σ amounts) over that Allocation's own
 *   period, clipped to the line's dates, instead of evenly over the line —
 *   so the Planner's shape shows up in the charts.
 * - **Quote-level discount.** v1 has only the Quote Discount (no line
 *   discounts). Its amount is spread over the buckets **in proportion to
 *   their gross revenue**, so every bucket carries the same effective
 *   discount rate and cash inflow (`revenue`) sums to the Quote's Total.
 * - **Exact sums.** Money is distributed in the currency's minor units and
 *   hours in thousandths with the largest-remainder method
 *   (`distributeWholeUnits`), so the buckets add up exactly to Subtotal,
 *   discount, Total, cost (rounded to the minor unit) and hours, instead of
 *   the old float rounding.
 * - **Headcount** is full-time equivalents: a bucket's Resource Role hours
 *   divided by its working hours (Mon–Fri days inside the Quote's dates ×
 *   the Organization's Hours Per Day). `hours` keeps the raw figure.
 * - Buckets are calendar months, quarters or years covering the Quote's
 *   dates (and any line outside them), empty ones included.
 */

export const FINANCIAL_GRANULARITIES = ["month", "quarter", "year"] as const
export type FinancialGranularity = (typeof FINANCIAL_GRANULARITIES)[number]

export interface FinancialAllocation {
  periodStart: IsoDate
  amount: DecimalInput
}

export interface FinancialLine {
  sourceKind: SourceKind
  startDate: IsoDate
  endDate: IsoDate
  /** The line's revenue before the Quote Discount (unit price × quantity, rounded). */
  lineTotal: DecimalInput
  unitCost: DecimalInput
  quantity: DecimalInput
  /** The line's Allocations (planner-managed lines), in `allocationPeriodType` buckets. */
  allocations?: readonly FinancialAllocation[]
}

export interface FinancialsInput {
  currency: string
  granularity: FinancialGranularity
  quote: { startDate: IsoDate; endDate: IsoDate }
  lines: readonly FinancialLine[]
  /** The Quote's persisted Quote Discount amount. */
  discountAmount: DecimalInput
  /** The bucket type of the Quote's Allocations (from its Time Period). */
  allocationPeriodType?: PeriodType
  /** The Organization's Hours Per Day, for headcount. */
  hoursPerDay: DecimalInput
}

export interface FinancialBucket {
  /** First and last day of the bucket (inclusive). */
  periodStart: IsoDate
  periodEnd: IsoDate
  /** "Oct 2026", "Q4 2026" or "2026". */
  label: string
  /** Revenue before the Quote Discount. */
  grossRevenue: string
  /** This bucket's share of the Quote Discount. */
  discount: string
  /** Cash inflow: grossRevenue − discount. */
  revenue: string
  cost: string
  /** revenue − cost. */
  margin: string
  /** Resource Role hours in the bucket (quantity scale). */
  hours: string
  /** Full-time equivalents (2 dp): hours / working hours in the bucket. */
  headcount: string
}

export interface FinancialsResult {
  granularity: FinancialGranularity
  buckets: FinancialBucket[]
  /** Σ of the buckets (equal to the Quote's Subtotal, discount, Total, cost). */
  totals: {
    grossRevenue: string
    discount: string
    revenue: string
    cost: string
    margin: string
    hours: string
    /** The largest bucket headcount. */
    peakHeadcount: string
  }
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

const parts = (date: IsoDate) => {
  const [y, m] = date.split("-").map(Number) as [number, number]
  return { y, m }
}
const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`

/** First day of the month / quarter / year containing `date`. */
export function startOfBucket(
  granularity: FinancialGranularity,
  date: IsoDate
): IsoDate {
  const { y, m } = parts(date)
  switch (granularity) {
    case "month":
      return iso(y, m, 1)
    case "quarter":
      return iso(y, Math.floor((m - 1) / 3) * 3 + 1, 1)
    case "year":
      return iso(y, 1, 1)
  }
}

/** Last day of the month / quarter / year starting at `start`. */
export function endOfBucket(
  granularity: FinancialGranularity,
  start: IsoDate
): IsoDate {
  switch (granularity) {
    case "month":
      return endOfPeriod("month", start)
    case "quarter":
      return endOfPeriod("quarter", start)
    case "year":
      return iso(parts(start).y, 12, 31)
  }
}

/** "Oct 2026", "Q4 2026" or "2026". */
export function bucketLabel(
  granularity: FinancialGranularity,
  start: IsoDate
): string {
  const { y, m } = parts(start)
  switch (granularity) {
    case "month":
      return `${MONTHS[m - 1]} ${y}`
    case "quarter":
      return `Q${Math.floor((m - 1) / 3) + 1} ${y}`
    case "year":
      return String(y)
  }
}

/** Calendar days two inclusive ranges share (0 when disjoint). */
export function overlapDays(
  aStart: IsoDate,
  aEnd: IsoDate,
  bStart: IsoDate,
  bEnd: IsoDate
): number {
  const start = maxDate(aStart, bStart)
  const end = minDate(aEnd, bEnd)
  return compareDates(end, start) < 0 ? 0 : daysBetween(start, end) + 1
}

/** The buckets covering `start`…`end`, in order. */
export function bucketsInRange(
  granularity: FinancialGranularity,
  start: IsoDate,
  end: IsoDate
): { periodStart: IsoDate; periodEnd: IsoDate }[] {
  const out: { periodStart: IsoDate; periodEnd: IsoDate }[] = []
  let current = startOfBucket(granularity, start)
  while (compareDates(current, end) <= 0) {
    const periodEnd = endOfBucket(granularity, current)
    out.push({ periodStart: current, periodEnd })
    current = addDays(periodEnd, 1)
  }
  return out
}

/** A stretch of a line's schedule carrying `weight` of the line. */
interface Segment {
  start: IsoDate
  end: IsoDate
  weight: Decimal
}

function lineSegments(
  line: FinancialLine,
  allocationPeriodType: PeriodType | undefined
): Segment[] {
  const whole: Segment[] = [
    { start: line.startDate, end: line.endDate, weight: new Decimal(1) },
  ]
  const allocations = line.allocations ?? []
  if (allocations.length === 0 || !allocationPeriodType) return whole
  const sum = allocations.reduce(
    (acc, a) => acc.plus(new Decimal(a.amount)),
    new Decimal(0)
  )
  if (sum.lte(0)) return whole
  return allocations.map((a) => {
    const periodEnd = endOfPeriod(allocationPeriodType, a.periodStart)
    const start = maxDate(a.periodStart, line.startDate)
    const end = minDate(periodEnd, line.endDate)
    // An Allocation outside the line's dates keeps its whole period.
    const clipped = compareDates(end, start) >= 0
    return {
      start: clipped ? start : a.periodStart,
      end: clipped ? end : periodEnd,
      weight: new Decimal(a.amount).dividedBy(sum),
    }
  })
}

/** The fraction of `line` falling in each bucket (sums to 1 when covered). */
function lineFractions(
  line: FinancialLine,
  buckets: readonly { periodStart: IsoDate; periodEnd: IsoDate }[],
  allocationPeriodType: PeriodType | undefined
): Decimal[] {
  const fractions = buckets.map(() => new Decimal(0))
  if (compareDates(line.endDate, line.startDate) < 0) return fractions
  for (const segment of lineSegments(line, allocationPeriodType)) {
    const days = daysBetween(segment.start, segment.end) + 1
    if (days <= 0) continue
    buckets.forEach((bucket, i) => {
      const overlap = overlapDays(
        bucket.periodStart,
        bucket.periodEnd,
        segment.start,
        segment.end
      )
      if (overlap > 0) {
        fractions[i] = fractions[i]!.plus(
          segment.weight.times(overlap).dividedBy(days)
        )
      }
    })
  }
  return fractions
}

/**
 * Split `total` over `weights` at `scale` decimals, exactly (largest
 * remainder). Returns Decimals.
 */
function distributeAtScale(
  total: Decimal,
  weights: readonly Decimal[],
  scale: number
): Decimal[] {
  if (weights.length === 0) return []
  const factor = new Decimal(10).pow(scale)
  const negative = total.isNegative()
  const units = total.abs().times(factor)
  // (With every weight zero the split is even; only reachable for a zero total.)
  return distributeWholeUnits(units, weights).map((s) => {
    const v = new Decimal(s).dividedBy(factor)
    return negative ? v.negated() : v
  })
}

/**
 * Revenue, cost, margin and headcount per month / quarter / year (see the
 * module comment for the rules).
 */
export function buildFinancials(input: FinancialsInput): FinancialsResult {
  const { granularity, currency } = input
  const minor = currencyMinorUnit(currency)
  let start = input.quote.startDate
  let end = input.quote.endDate
  for (const line of input.lines) {
    start = minDate(start, line.startDate)
    end = maxDate(end, line.endDate)
  }
  const ranges = bucketsInRange(granularity, start, end)

  const gross = ranges.map(() => new Decimal(0))
  const cost = ranges.map(() => new Decimal(0))
  const hours = ranges.map(() => new Decimal(0))
  let grossTotal = new Decimal(0)
  let costTotal = new Decimal(0)
  let hoursTotal = new Decimal(0)
  for (const line of input.lines) {
    // A line that ends before it starts has no schedule (the db forbids it).
    if (compareDates(line.endDate, line.startDate) < 0) continue
    const fractions = lineFractions(line, ranges, input.allocationPeriodType)
    const lineRevenue = new Decimal(line.lineTotal)
    const lineCost = new Decimal(line.unitCost).times(line.quantity)
    const lineHours =
      line.sourceKind === "resource_role"
        ? new Decimal(line.quantity)
        : new Decimal(0)
    grossTotal = grossTotal.plus(lineRevenue)
    costTotal = costTotal.plus(lineCost)
    hoursTotal = hoursTotal.plus(lineHours)
    fractions.forEach((f, i) => {
      gross[i] = gross[i]!.plus(lineRevenue.times(f))
      cost[i] = cost[i]!.plus(lineCost.times(f))
      hours[i] = hours[i]!.plus(lineHours.times(f))
    })
  }

  const round = (d: Decimal) => d.toDecimalPlaces(minor, Decimal.ROUND_HALF_UP)
  const grossBuckets = distributeAtScale(round(grossTotal), gross, minor)
  const discountTotal = Decimal.min(
    round(grossTotal),
    Decimal.max(0, new Decimal(input.discountAmount))
  )
  const discountBuckets = distributeAtScale(discountTotal, grossBuckets, minor)
  const costBuckets = distributeAtScale(round(costTotal), cost, minor)
  const hourBuckets = distributeAtScale(hoursTotal, hours, 3)

  const hoursPerDay = new Decimal(input.hoursPerDay)
  let peak = new Decimal(0)
  const buckets = ranges.map((range, i): FinancialBucket => {
    const revenue = grossBuckets[i]!.minus(discountBuckets[i]!)
    const workingDays = countWorkingDays(
      maxDate(range.periodStart, input.quote.startDate),
      minDate(range.periodEnd, input.quote.endDate)
    )
    const capacity = hoursPerDay.times(workingDays)
    const headcount = capacity.gt(0)
      ? hourBuckets[i]!.dividedBy(capacity).toDecimalPlaces(
          2,
          Decimal.ROUND_HALF_UP
        )
      : new Decimal(0)
    if (headcount.gt(peak)) peak = headcount
    return {
      periodStart: range.periodStart,
      periodEnd: range.periodEnd,
      label: bucketLabel(granularity, range.periodStart),
      grossRevenue: toMoneyString(grossBuckets[i]!),
      discount: toMoneyString(discountBuckets[i]!),
      revenue: toMoneyString(revenue),
      cost: toMoneyString(costBuckets[i]!),
      margin: toMoneyString(revenue.minus(costBuckets[i]!)),
      hours: toQuantityString(hourBuckets[i]!),
      headcount: headcount.toFixed(2),
    }
  })

  const revenueTotal = round(grossTotal).minus(discountTotal)
  return {
    granularity,
    buckets,
    totals: {
      grossRevenue: toMoneyString(round(grossTotal)),
      discount: toMoneyString(discountTotal),
      revenue: toMoneyString(revenueTotal),
      cost: toMoneyString(round(costTotal)),
      margin: toMoneyString(revenueTotal.minus(round(costTotal))),
      hours: toQuantityString(hoursTotal),
      peakHeadcount: peak.toFixed(2),
    },
  }
}

/**
 * One item type of the breakdown: labour (Resource Roles) or one Catalog
 * Type. `key` is "resource_role" for labour, else the Catalog Type's id.
 */
export interface ItemTypeBreakdown {
  key: string
  sourceKind: SourceKind
  /** The Catalog Type (null for labour). */
  catalogTypeId: string | null
  lineCount: number
  /** Σ line totals (before the Quote Discount). */
  revenue: string
  cost: string
  /** revenue − cost: the lines' own margin. */
  margin: string
  marginPct: string
  /** revenue / Subtotal × 100 (0 when the Subtotal is 0). */
  shareOfSubtotal: string
}

/** A line as the breakdown reads it. */
export interface ItemTypeLine extends Pick<
  FinancialLine,
  "sourceKind" | "lineTotal" | "unitCost" | "quantity"
> {
  /** The line's Catalog Type (through its Catalog Item); null for labour. */
  catalogTypeId: string | null
}

/** The breakdown key of a line: "resource_role", or its Catalog Type's id. */
export const itemTypeKey = (line: {
  sourceKind: SourceKind
  catalogTypeId: string | null
}) =>
  line.sourceKind === "resource_role"
    ? "resource_role"
    : (line.catalogTypeId ?? "catalog_item")

/**
 * The item-type breakdown: labour (Resource Roles) first, then each of
 * `catalogTypeIds` in the given order (the Organization's Catalog Types),
 * then any other type the lines use. Each row has the type's revenue, cost
 * and own margin before the Quote Discount, and its share of the Subtotal.
 * Every listed type appears, empty ones with zeros.
 */
export function breakdownByItemType(
  lines: readonly ItemTypeLine[],
  catalogTypeIds: readonly string[] = []
): ItemTypeBreakdown[] {
  const subtotal = lines.reduce(
    (acc, l) => acc.plus(new Decimal(l.lineTotal)),
    new Decimal(0)
  )
  const keys = ["resource_role", ...catalogTypeIds]
  for (const line of lines) {
    const key = itemTypeKey(line)
    if (!keys.includes(key)) keys.push(key)
  }
  return keys.map((key) => {
    const mine = lines.filter((l) => itemTypeKey(l) === key)
    const revenue = mine.reduce(
      (acc, l) => acc.plus(new Decimal(l.lineTotal)),
      new Decimal(0)
    )
    const cost = mine.reduce(
      (acc, l) => acc.plus(new Decimal(l.unitCost).times(l.quantity)),
      new Decimal(0)
    )
    const margin = revenue.minus(cost)
    const labour = key === "resource_role"
    return {
      key,
      sourceKind: labour ? "resource_role" : "catalog_item",
      catalogTypeId: labour ? null : key,
      lineCount: mine.length,
      revenue: toMoneyString(revenue),
      cost: toMoneyString(cost),
      margin: toMoneyString(margin),
      marginPct: toPercentString(
        revenue.isZero() ? 0 : margin.dividedBy(revenue).times(100)
      ),
      shareOfSubtotal: toPercentString(
        subtotal.isZero() ? 0 : revenue.dividedBy(subtotal).times(100)
      ),
    }
  })
}
