import { Decimal } from "decimal.js"

import {
  addPeriods,
  compareDates,
  countWorkingDays,
  endOfPeriod,
  type IsoDate,
  maxDate,
  minDate,
  periodStartsInRange,
  periodTypeForTimePeriod,
  startOfPeriod,
} from "../dates"
import { distributeWholeUnits } from "../effort"
import type { BillingUnit, PeriodType, TimePeriod } from "../enums"
import { type DecimalInput, toQuantityString } from "../money"
import { hoursPerTimePeriod } from "../pricing"

/**
 * Allocations: the per-period Effort of a Resource Role Line Item, as laid
 * out in the Resource Planner. Each Allocation sits in one bucket of the
 * Quote's Time Period (see `periodTypeForTimePeriod`), keyed by the bucket's
 * first day. For planner-managed lines the Line Item's quantity is always the
 * sum of its Allocations; every function here returns the quantity (and the
 * dates it implies) together with the Allocations so the two can't drift.
 *
 * Changing a Quote's Time Period discards all its Allocations (the API
 * deletes them; nothing here converts between bucket sizes).
 */

export interface AllocationInput {
  /** Any day in the bucket; outputs always use the bucket's first day. */
  periodStart: IsoDate
  amount: DecimalInput
}

export interface Allocation {
  /** First day of the bucket. */
  periodStart: IsoDate
  /** Quantity-scale string, e.g. "40.000". Never zero in outputs. */
  amount: string
}

const MAX_AMOUNT: Record<PeriodType, Record<BillingUnit, number>> = {
  week: { hour: 168, each: 1_000 },
  month: { hour: 744, each: 4_000 },
  quarter: { hour: 2_160, each: 12_000 },
}

/** Per-cell maximum: 168 / 744 / 2,160 hours, or 1,000 / 4,000 / 12,000 each. */
export function maxAllocationAmount(
  periodType: PeriodType,
  billingUnit: BillingUnit
): string {
  return toQuantityString(MAX_AMOUNT[periodType][billingUnit])
}

export type AmountRefusal = "invalid" | "negative" | "not_whole" | "exceeds_max"

export type AmountCheck =
  | { ok: true }
  | { ok: false; reason: AmountRefusal; message: string }

/**
 * Validate one planner cell: a non-negative number, a whole number for Each,
 * and at most the bucket's maximum. Zero is valid (it clears the cell).
 */
export function checkAllocationAmount(
  amount: DecimalInput,
  periodType: PeriodType,
  billingUnit: BillingUnit
): AmountCheck {
  let value: Decimal
  try {
    value = new Decimal(amount)
  } catch {
    return { ok: false, reason: "invalid", message: "Enter a number." }
  }
  if (!value.isFinite()) {
    return { ok: false, reason: "invalid", message: "Enter a number." }
  }
  if (value.isNegative() && !value.isZero()) {
    return {
      ok: false,
      reason: "negative",
      message: "Allocations can't be negative.",
    }
  }
  if (billingUnit === "each" && !value.isInteger()) {
    return {
      ok: false,
      reason: "not_whole",
      message: "Each-billed Allocations must be whole numbers.",
    }
  }
  const max = MAX_AMOUNT[periodType][billingUnit]
  if (value.greaterThan(max)) {
    return {
      ok: false,
      reason: "exceeds_max",
      message: `At most ${max.toLocaleString("en-US")} ${billingUnit === "hour" ? "hours" : "units"} per ${periodType}.`,
    }
  }
  return { ok: true }
}

/** Σ amounts, at quantity scale. */
export function sumAllocations(
  allocations: readonly AllocationInput[]
): string {
  return toQuantityString(
    allocations.reduce((sum, a) => sum.plus(a.amount), new Decimal(0))
  )
}

/**
 * Snap every Allocation to its bucket start, merge (sum) duplicates, drop
 * zeros and sort by period.
 */
export function normalizeAllocations(
  timePeriod: TimePeriod,
  allocations: readonly AllocationInput[]
): Allocation[] {
  const periodType = periodTypeForTimePeriod(timePeriod)
  const byPeriod = new Map<IsoDate, Decimal>()
  for (const a of allocations) {
    const key = startOfPeriod(periodType, a.periodStart)
    byPeriod.set(key, (byPeriod.get(key) ?? new Decimal(0)).plus(a.amount))
  }
  return toSortedAllocations(byPeriod)
}

function toSortedAllocations(byPeriod: Map<IsoDate, Decimal>): Allocation[] {
  return [...byPeriod.entries()]
    .filter(([, amount]) => !amount.isZero())
    .sort(([a], [b]) => compareDates(a, b))
    .map(([periodStart, amount]) => ({
      periodStart,
      amount: toQuantityString(amount),
    }))
}

/** The window a planner-managed line must stay inside. */
export interface QuoteWindow {
  startDate: IsoDate
  endDate: IsoDate
}

/** A planner-managed line's schedule: its Allocations and what they imply. */
export interface AllocatedSchedule {
  allocations: Allocation[]
  /** Σ Allocations. */
  quantity: string
  startDate: IsoDate
  endDate: IsoDate
}

/**
 * The quantity and dates implied by a line's Allocations (port of the
 * planner's `plannerValuesToLineItemUpdates`):
 * - quantity is Σ Allocations;
 * - the start tracks the first allocated bucket, keeping the exact current
 *   start day while it stays in that bucket, and never before the Quote start;
 * - the end tracks the last allocated bucket the same way (bucket end unless
 *   the current end is inside it), never after the Quote end;
 * - with no Allocations the quantity is 0 and the dates are kept.
 */
export function scheduleFromAllocations(input: {
  timePeriod: TimePeriod
  allocations: readonly AllocationInput[]
  line: { startDate: IsoDate; endDate: IsoDate }
  quote: QuoteWindow
}): AllocatedSchedule {
  const periodType = periodTypeForTimePeriod(input.timePeriod)
  const allocations = normalizeAllocations(input.timePeriod, input.allocations)
  const { line, quote } = input
  const first = allocations[0]
  const last = allocations[allocations.length - 1]
  if (!first || !last) {
    return {
      allocations,
      quantity: toQuantityString(0),
      startDate: line.startDate,
      endDate: line.endDate,
    }
  }

  const startDate =
    startOfPeriod(periodType, line.startDate) === first.periodStart
      ? line.startDate
      : first.periodStart
  const endDate =
    startOfPeriod(periodType, line.endDate) === last.periodStart
      ? line.endDate
      : endOfPeriod(periodType, last.periodStart)
  const clampedStart = maxDate(startDate, quote.startDate)
  return {
    allocations,
    quantity: sumAllocations(allocations),
    startDate: clampedStart,
    endDate: maxDate(clampedStart, minDate(endDate, quote.endDate)),
  }
}

export interface AllocationEdit {
  /** Any day in the target bucket. */
  periodStart: IsoDate
  /** New amount for the cell; 0 clears it. */
  amount: DecimalInput
}

export type AllocationEditRefusal = AmountRefusal | "outside_quote"

export type AllocationEditResult =
  | ({ ok: true } & AllocatedSchedule)
  | {
      ok: false
      errors: Array<{
        periodStart: IsoDate
        reason: AllocationEditRefusal
        message: string
      }>
    }

/**
 * Apply one planner gesture (typing a cell, filling a range, drag-fill,
 * clearing a row) as a batch of cell edits. Every cell is validated (caps,
 * whole numbers for Each, bucket overlapping the Quote dates); if any fails,
 * nothing is applied. Returns the new Allocations with the quantity and dates
 * they imply.
 */
export function applyAllocationEdits(input: {
  timePeriod: TimePeriod
  billingUnit: BillingUnit
  line: {
    startDate: IsoDate
    endDate: IsoDate
    allocations: readonly AllocationInput[]
  }
  quote: QuoteWindow
  edits: readonly AllocationEdit[]
}): AllocationEditResult {
  const periodType = periodTypeForTimePeriod(input.timePeriod)
  const errors: Extract<AllocationEditResult, { ok: false }>["errors"] = []
  const byPeriod = new Map<IsoDate, Decimal>(
    normalizeAllocations(input.timePeriod, input.line.allocations).map((a) => [
      a.periodStart,
      new Decimal(a.amount),
    ])
  )

  for (const edit of input.edits) {
    const periodStart = startOfPeriod(periodType, edit.periodStart)
    const check = checkAllocationAmount(
      edit.amount,
      periodType,
      input.billingUnit
    )
    if (!check.ok) {
      errors.push({ periodStart, reason: check.reason, message: check.message })
      continue
    }
    const outside =
      compareDates(
        endOfPeriod(periodType, periodStart),
        input.quote.startDate
      ) < 0 || compareDates(periodStart, input.quote.endDate) > 0
    if (outside) {
      errors.push({
        periodStart,
        reason: "outside_quote",
        message: "This period is outside the Quote dates.",
      })
      continue
    }
    byPeriod.set(periodStart, new Decimal(edit.amount))
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    ...scheduleFromAllocations({
      timePeriod: input.timePeriod,
      allocations: toSortedAllocations(byPeriod),
      line: input.line,
      quote: input.quote,
    }),
  }
}

/**
 * Initial Allocations for a Resource Role line (e.g. when it is added, or
 * when the planner first lays out a line without any): the quantity is spread
 * over the buckets its dates cover, in whole hours via largest-remainder,
 * weighted by the working days each bucket shares with the line. A line that
 * starts on a Wednesday therefore gets 3 days' share of its first week, not 5.
 * Each-billed lines are split evenly in whole units.
 */
export function defaultAllocations(input: {
  timePeriod: TimePeriod
  billingUnit: BillingUnit
  quantity: DecimalInput
  startDate: IsoDate
  endDate: IsoDate
}): Allocation[] {
  const periodType = periodTypeForTimePeriod(input.timePeriod)
  const { startDate, endDate } = input
  const starts = periodStartsInRange(periodType, startDate, endDate)
  const weights = starts.map((start) =>
    input.billingUnit === "each"
      ? 1
      : countWorkingDays(
          maxDate(start, startDate),
          minDate(endOfPeriod(periodType, start), endDate)
        )
  )
  const shares = distributeWholeUnits(input.quantity, weights)
  return normalizeAllocations(
    input.timePeriod,
    starts.map((periodStart, i) => ({ periodStart, amount: shares[i] ?? 0 }))
  )
}

export type ResizeEffortResult =
  | ({ ok: true } & AllocatedSchedule)
  | { ok: false; reason: "negative" | "exceeds_quote_end"; message: string }

/**
 * Change a planner-managed line's total Effort while keeping quantity equal
 * to Σ Allocations (port of `growLineItemEffort`, plus the shrink half):
 * - growing keeps the existing (possibly shaped) Allocations and appends
 *   full-load buckets after the last one — 5 × HPD a week, 20 × HPD a month,
 *   60 × HPD a quarter — with a partial final bucket; it is refused if it
 *   would need a bucket after the Quote End Date;
 * - shrinking trims Effort from the latest buckets backwards.
 */
export function resizeAllocatedEffort(input: {
  timePeriod: TimePeriod
  hoursPerDay: DecimalInput
  quantity: DecimalInput
  line: {
    startDate: IsoDate
    endDate: IsoDate
    allocations: readonly AllocationInput[]
  }
  quote: QuoteWindow
}): ResizeEffortResult {
  const periodType = periodTypeForTimePeriod(input.timePeriod)
  const target = new Decimal(input.quantity)
  if (target.isNegative() && !target.isZero()) {
    return {
      ok: false,
      reason: "negative",
      message: "Effort can't be negative.",
    }
  }
  const cells = normalizeAllocations(input.timePeriod, input.line.allocations)
  const byPeriod = new Map<IsoDate, Decimal>(
    cells.map((a) => [a.periodStart, new Decimal(a.amount)])
  )
  const current = new Decimal(sumAllocations(cells))

  if (target.lessThan(current)) {
    let excess = current.minus(target)
    for (const cell of [...cells].reverse()) {
      if (excess.isZero()) break
      const amount = new Decimal(cell.amount)
      const cut = Decimal.min(amount, excess)
      byPeriod.set(cell.periodStart, amount.minus(cut))
      excess = excess.minus(cut)
    }
  } else if (target.greaterThan(current)) {
    const fullLoad = new Decimal(
      hoursPerTimePeriod(
        periodType === "week" ? "weeks" : input.timePeriod,
        input.hoursPerDay
      )
    )
    const last = cells[cells.length - 1]
    let next = last
      ? addPeriods(periodType, last.periodStart, 1)
      : startOfPeriod(periodType, input.line.startDate)
    let remaining = target.minus(current)
    while (remaining.greaterThan(0)) {
      if (compareDates(next, input.quote.endDate) > 0) {
        return {
          ok: false,
          reason: "exceeds_quote_end",
          message: "That much Effort doesn't fit before the Quote End Date.",
        }
      }
      const amount = Decimal.min(fullLoad, remaining)
      byPeriod.set(next, amount)
      remaining = remaining.minus(amount)
      next = addPeriods(periodType, next, 1)
    }
  }

  return {
    ok: true,
    ...scheduleFromAllocations({
      timePeriod: input.timePeriod,
      allocations: toSortedAllocations(byPeriod),
      line: input.line,
      quote: input.quote,
    }),
  }
}

/**
 * What to write to move a line's stored Allocations from `before` to `after`
 * (both keyed by bucket start): rows to insert or update, and the period
 * starts to delete. Unchanged cells appear in neither list.
 */
export function diffAllocations(
  timePeriod: TimePeriod,
  before: readonly AllocationInput[],
  after: readonly AllocationInput[]
): { upserts: Allocation[]; deletes: IsoDate[] } {
  const old = new Map(
    normalizeAllocations(timePeriod, before).map((a) => [a.periodStart, a])
  )
  const next = normalizeAllocations(timePeriod, after)
  const nextKeys = new Set(next.map((a) => a.periodStart))
  return {
    upserts: next.filter((a) => {
      const prev = old.get(a.periodStart)
      return !prev || !new Decimal(prev.amount).equals(a.amount)
    }),
    deletes: [...old.keys()].filter((key) => !nextKeys.has(key)),
  }
}
