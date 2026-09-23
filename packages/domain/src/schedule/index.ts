import { Decimal } from "decimal.js"

import {
  type Allocation,
  type AllocationInput,
  normalizeAllocations,
  sumAllocations,
} from "../allocations"
import {
  addDays,
  addPeriods,
  compareDates,
  countWorkingDays,
  daysBetween,
  endOfPeriod,
  type IsoDate,
  maxDate,
  minDate,
  periodsBetween,
  periodTypeForTimePeriod,
  startOfPeriod,
} from "../dates"
import type { BillingUnit, SourceKind, TimePeriod } from "../enums"
import { type DecimalInput, toQuantityString } from "../money"
import { priceQuote, type QuoteDiscount } from "../pricing"

/**
 * Rescheduling: moving the Quote dates (Quote Shift or clamp) and moving one
 * Line Item's start (lift-and-shift). Both are pure previews: they return the
 * new dates, quantities and Allocations of every affected line plus an impact
 * summary, and the API persists them (or, in preview mode, only shows them).
 *
 * A line is **planner-managed** when it is a Resource Role line with at least
 * one Allocation; its quantity is kept equal to Σ Allocations. Every other
 * line only has its dates moved; its quantity never changes here.
 */

export interface ScheduleLine {
  id: string
  sourceKind: SourceKind
  billingUnit: BillingUnit
  startDate: IsoDate
  endDate: IsoDate
  quantity: DecimalInput
  unitPrice: DecimalInput
  unitCost: DecimalInput
  allocations: readonly AllocationInput[]
}

export interface ScheduleQuote {
  startDate: IsoDate
  endDate: IsoDate
  timePeriod: TimePeriod
  /** The Organization's Hours Per Day (caps clamped boundary periods). */
  hoursPerDay: DecimalInput
  /** Used only to report the old and new Total. */
  currency: string
  discount?: QuoteDiscount | null
}

/** A line after rescheduling. */
export interface ScheduledLine {
  id: string
  startDate: IsoDate
  endDate: IsoDate
  quantity: string
  allocations: Allocation[]
  /** False when nothing about the line changed (callers can skip writing it). */
  changed: boolean
}

export interface LineImpact {
  id: string
  oldStartDate: IsoDate
  newStartDate: IsoDate
  oldEndDate: IsoDate
  newEndDate: IsoDate
  oldQuantity: string
  newQuantity: string
  /** The line's date was cut to the new Quote bound. */
  clamped: boolean
  /** The line lost Effort. */
  effortReduced: boolean
}

function isPlannerManaged(line: ScheduleLine): boolean {
  return line.sourceKind === "resource_role" && line.allocations.length > 0
}

function unchanged(line: ScheduleLine, timePeriod: TimePeriod): ScheduledLine {
  return {
    id: line.id,
    startDate: line.startDate,
    endDate: line.endDate,
    quantity: toQuantityString(line.quantity),
    allocations: normalizeAllocations(timePeriod, line.allocations),
    changed: false,
  }
}

function sameAllocations(a: readonly Allocation[], b: readonly Allocation[]) {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.periodStart === b[i]?.periodStart &&
        new Decimal(x.amount).equals(b[i]?.amount ?? 0)
    )
  )
}

function finish(
  line: ScheduleLine,
  timePeriod: TimePeriod,
  next: Omit<ScheduledLine, "id" | "changed">
): ScheduledLine {
  const before = unchanged(line, timePeriod)
  const changed =
    before.startDate !== next.startDate ||
    before.endDate !== next.endDate ||
    !new Decimal(before.quantity).equals(next.quantity) ||
    !sameAllocations(before.allocations, next.allocations)
  return { id: line.id, ...next, changed }
}

function impactOf(line: ScheduleLine, next: ScheduledLine): LineImpact {
  const oldQuantity = toQuantityString(line.quantity)
  return {
    id: line.id,
    oldStartDate: line.startDate,
    newStartDate: next.startDate,
    oldEndDate: line.endDate,
    newEndDate: next.endDate,
    oldQuantity,
    newQuantity: next.quantity,
    clamped: false,
    effortReduced: new Decimal(next.quantity).lessThan(oldQuantity),
  }
}

function totalOf(
  quote: ScheduleQuote,
  lines: ReadonlyArray<{
    unitPrice: DecimalInput
    unitCost: DecimalInput
    quantity: DecimalInput
  }>
): string {
  return priceQuote({
    currency: quote.currency,
    discount: quote.discount,
    lines,
  }).total
}

/** Shift allocations by whole buckets, as the line's start bucket moved. */
function liftAllocations(
  line: ScheduleLine,
  timePeriod: TimePeriod,
  newStart: IsoDate
): Allocation[] {
  const periodType = periodTypeForTimePeriod(timePeriod)
  const offset = periodsBetween(periodType, line.startDate, newStart)
  return normalizeAllocations(
    timePeriod,
    line.allocations.map((a) => ({
      periodStart: addPeriods(periodType, a.periodStart, offset),
      amount: a.amount,
    }))
  )
}

// ─── Quote date change ──────────────────────────────────────────────────────

export type QuoteDateChange =
  | {
      field: "start"
      date: IsoDate
      /** `shift` (default) slides the whole Quote; `clamp` cuts early work. */
      mode?: "shift" | "clamp"
    }
  | { field: "end"; date: IsoDate }

export interface QuoteDateImpact {
  field: "start" | "end"
  mode: "shift" | "clamp"
  /**
   * `inward` shrinks the window; `outward` widens it (nothing else moves).
   * For a Quote Shift, `inward` means later and `outward` earlier.
   */
  direction: "inward" | "outward" | "none"
  /** Lines whose dates, quantity or Allocations changed. */
  impactedCount: number
  /** Lines whose date was cut to the new bound (clamp only). */
  clampedCount: number
  /** Lines that lost Effort (clamp only; a Quote Shift preserves Effort). */
  effortReducedCount: number
  /** Only lines that changed. */
  lines: LineImpact[]
  oldTotal: string
  newTotal: string
  /** True when the change is consequential enough to confirm first. */
  requiresConfirmation: boolean
}

export type QuoteDateChangeRefusal =
  | "end_before_start"
  | "start_after_end"
  | "line_item_outside"

export type QuoteDateChangeResult =
  | {
      ok: true
      startDate: IsoDate
      endDate: IsoDate
      /** Every input line, in input order. */
      lines: ScheduledLine[]
      impact: QuoteDateImpact
    }
  | {
      ok: false
      reason: QuoteDateChangeRefusal
      message: string
      /** The line that blocks the change, for `line_item_outside`. */
      lineItemId?: string
    }

/**
 * Compute a Quote Start or End Date change (port of `computeQuoteDateChange`).
 *
 * - **Quote Shift** (the default for a start move): the Quote End Date and
 *   every line move by the same number of days; Allocations move by the whole
 *   buckets their line's start moved. All Effort is kept.
 * - **Clamp** (an end move, or a start move with `mode: "clamp"`): moving a
 *   date outward changes nothing else. Moving it inward cuts every line that
 *   overruns the new bound to it; planner-managed lines also drop Allocations
 *   outside the window and cap the boundary period at its surviving working
 *   days × Hours Per Day (never raising an amount). Moving a bound past a
 *   line entirely is refused.
 */
export function changeQuoteDates(input: {
  quote: ScheduleQuote
  lines: readonly ScheduleLine[]
  change: QuoteDateChange
}): QuoteDateChangeResult {
  const { quote, lines, change } = input
  const mode =
    change.field === "start" ? (change.mode ?? "shift") : ("clamp" as const)
  const oldTotal = totalOf(quote, lines)

  if (change.field === "start" && mode === "shift") {
    return shiftQuote(quote, lines, change.date, oldTotal)
  }

  const refusal = validateClamp(quote, lines, change)
  if (refusal) return { ok: false, ...refusal }

  const oldBound = change.field === "start" ? quote.startDate : quote.endDate
  const cmp = compareDates(change.date, oldBound)
  const inward = change.field === "start" ? cmp > 0 : cmp < 0
  const startDate = change.field === "start" ? change.date : quote.startDate
  const endDate = change.field === "end" ? change.date : quote.endDate

  const scheduled = lines.map((line) =>
    inward
      ? clampLine(quote, line, change.field, change.date)
      : unchanged(line, quote.timePeriod)
  )
  const impacts = lines.flatMap((line, i) => {
    const next = scheduled[i]!
    if (!next.changed) return []
    return [{ ...impactOf(line, next), clamped: true }]
  })
  const newTotal = totalOf(
    quote,
    lines.map((line, i) => ({ ...line, quantity: scheduled[i]!.quantity }))
  )

  return {
    ok: true,
    startDate,
    endDate,
    lines: scheduled,
    impact: {
      field: change.field,
      mode: "clamp",
      direction: cmp === 0 ? "none" : inward ? "inward" : "outward",
      impactedCount: impacts.length,
      clampedCount: impacts.length,
      effortReducedCount: impacts.filter((i) => i.effortReduced).length,
      lines: impacts,
      oldTotal,
      newTotal,
      requiresConfirmation: impacts.length > 0,
    },
  }
}

function validateClamp(
  quote: ScheduleQuote,
  lines: readonly ScheduleLine[],
  change: QuoteDateChange
): Omit<Extract<QuoteDateChangeResult, { ok: false }>, "ok"> | null {
  if (change.field === "end") {
    if (compareDates(change.date, quote.startDate) < 0) {
      return {
        reason: "end_before_start",
        message: `The Quote End Date must be on or after the Quote Start Date (${quote.startDate}).`,
      }
    }
    const blocking = latest(lines, (l) => l.startDate)
    if (blocking && compareDates(change.date, blocking.startDate) < 0) {
      return {
        reason: "line_item_outside",
        message: `The Quote End Date must be on or after ${blocking.startDate}, when a Line Item starts.`,
        lineItemId: blocking.id,
      }
    }
    return null
  }
  if (compareDates(change.date, quote.endDate) > 0) {
    return {
      reason: "start_after_end",
      message: `The Quote Start Date must be on or before the Quote End Date (${quote.endDate}).`,
    }
  }
  const blocking = earliest(lines, (l) => l.endDate)
  if (blocking && compareDates(change.date, blocking.endDate) > 0) {
    return {
      reason: "line_item_outside",
      message: `The Quote Start Date must be on or before ${blocking.endDate}, when a Line Item ends.`,
      lineItemId: blocking.id,
    }
  }
  return null
}

function latest(
  lines: readonly ScheduleLine[],
  date: (l: ScheduleLine) => IsoDate
): ScheduleLine | undefined {
  return lines.reduce<ScheduleLine | undefined>(
    (best, l) => (!best || compareDates(date(l), date(best)) > 0 ? l : best),
    undefined
  )
}

function earliest(
  lines: readonly ScheduleLine[],
  date: (l: ScheduleLine) => IsoDate
): ScheduleLine | undefined {
  return lines.reduce<ScheduleLine | undefined>(
    (best, l) => (!best || compareDates(date(l), date(best)) < 0 ? l : best),
    undefined
  )
}

function clampLine(
  quote: ScheduleQuote,
  line: ScheduleLine,
  field: "start" | "end",
  bound: IsoDate
): ScheduledLine {
  const overruns =
    field === "end"
      ? compareDates(line.endDate, bound) > 0
      : compareDates(line.startDate, bound) < 0
  if (!overruns) return unchanged(line, quote.timePeriod)

  const startDate = field === "start" ? bound : line.startDate
  const endDate = field === "end" ? bound : line.endDate
  if (!isPlannerManaged(line)) {
    return finish(line, quote.timePeriod, {
      startDate,
      endDate,
      quantity: toQuantityString(line.quantity),
      allocations: normalizeAllocations(quote.timePeriod, line.allocations),
    })
  }

  const periodType = periodTypeForTimePeriod(quote.timePeriod)
  const hoursPerDay = new Decimal(quote.hoursPerDay)
  const kept: AllocationInput[] = []
  for (const alloc of normalizeAllocations(
    quote.timePeriod,
    line.allocations
  )) {
    const periodStart = alloc.periodStart
    const periodEnd = endOfPeriod(periodType, periodStart)
    // Entirely outside the surviving window → dropped.
    if (compareDates(periodEnd, startDate) < 0) continue
    if (compareDates(periodStart, endDate) > 0) continue
    // The boundary period keeps at most its surviving working days × HPD.
    const cutByBound =
      field === "end"
        ? compareDates(periodEnd, bound) > 0
        : compareDates(periodStart, bound) < 0
    let amount = new Decimal(alloc.amount)
    if (cutByBound && line.billingUnit === "hour") {
      const days = countWorkingDays(
        maxDate(periodStart, startDate),
        minDate(periodEnd, endDate)
      )
      amount = Decimal.min(amount, hoursPerDay.times(days))
    }
    kept.push({ periodStart, amount })
  }
  const allocations = normalizeAllocations(quote.timePeriod, kept)
  return finish(line, quote.timePeriod, {
    startDate,
    endDate,
    quantity: sumAllocations(allocations),
    allocations,
  })
}

function shiftQuote(
  quote: ScheduleQuote,
  lines: readonly ScheduleLine[],
  newStart: IsoDate,
  oldTotal: string
): QuoteDateChangeResult {
  const delta = daysBetween(quote.startDate, newStart)
  const scheduled = lines.map((line) =>
    delta === 0
      ? unchanged(line, quote.timePeriod)
      : finish(line, quote.timePeriod, {
          startDate: addDays(line.startDate, delta),
          endDate: addDays(line.endDate, delta),
          quantity: toQuantityString(line.quantity),
          allocations: liftAllocations(
            line,
            quote.timePeriod,
            addDays(line.startDate, delta)
          ),
        })
  )
  const impacts = lines.flatMap((line, i) => {
    const next = scheduled[i]!
    return next.changed ? [impactOf(line, next)] : []
  })
  return {
    ok: true,
    startDate: newStart,
    endDate: addDays(quote.endDate, delta),
    lines: scheduled,
    impact: {
      field: "start",
      mode: "shift",
      direction: delta === 0 ? "none" : delta > 0 ? "inward" : "outward",
      impactedCount: impacts.length,
      clampedCount: 0,
      effortReducedCount: 0,
      lines: impacts,
      oldTotal,
      newTotal: oldTotal,
      requiresConfirmation: impacts.length > 0,
    },
  }
}

// ─── Line Item start change ─────────────────────────────────────────────────

export type LineItemStartChangeResult =
  | {
      ok: true
      line: ScheduledLine
      impact: LineImpact & {
        direction: "earlier" | "later" | "same"
        /** True when Effort changed, so the user should confirm. */
        requiresConfirmation: boolean
      }
    }
  | {
      ok: false
      reason: "before_quote_start" | "after_quote_end"
      message: string
    }

/**
 * Move one Line Item's start date by lift-and-shift (port of
 * `computeLineItemStartDateChange`). The start must stay within the Quote
 * dates. The end moves by the same number of days, trimmed at the Quote End
 * Date. A planner-managed line's Allocations move by the whole buckets its
 * start moved, keeping their shape; Allocations pushed past the Quote End
 * Date's bucket are dropped (the only way Effort is lost). The Quote dates
 * never change.
 */
export function changeLineItemStart(input: {
  quote: Pick<ScheduleQuote, "startDate" | "endDate" | "timePeriod">
  line: ScheduleLine
  startDate: IsoDate
}): LineItemStartChangeResult {
  const { quote, line, startDate } = input
  if (compareDates(startDate, quote.startDate) < 0) {
    return {
      ok: false,
      reason: "before_quote_start",
      message: `The start date can't be earlier than the Quote Start Date (${quote.startDate}).`,
    }
  }
  if (compareDates(startDate, quote.endDate) > 0) {
    return {
      ok: false,
      reason: "after_quote_end",
      message: `The start date can't be later than the Quote End Date (${quote.endDate}).`,
    }
  }

  const delta = daysBetween(line.startDate, startDate)
  const endDate = maxDate(
    startDate,
    minDate(addDays(line.endDate, delta), quote.endDate)
  )

  let quantity = toQuantityString(line.quantity)
  let allocations = normalizeAllocations(quote.timePeriod, line.allocations)
  if (isPlannerManaged(line)) {
    const periodType = periodTypeForTimePeriod(quote.timePeriod)
    const first = startOfPeriod(periodType, quote.startDate)
    const last = startOfPeriod(periodType, quote.endDate)
    allocations = liftAllocations(line, quote.timePeriod, startDate).filter(
      (a) =>
        compareDates(a.periodStart, first) >= 0 &&
        compareDates(a.periodStart, last) <= 0
    )
    quantity = sumAllocations(allocations)
  }

  const next = finish(line, quote.timePeriod, {
    startDate,
    endDate,
    quantity,
    allocations,
  })
  const impact = impactOf(line, next)
  return {
    ok: true,
    line: next,
    impact: {
      ...impact,
      clamped: compareDates(endDate, addDays(line.endDate, delta)) < 0,
      direction: delta === 0 ? "same" : delta > 0 ? "later" : "earlier",
      requiresConfirmation: impact.oldQuantity !== impact.newQuantity,
    },
  }
}
