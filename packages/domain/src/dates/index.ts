import {
  addDays as addDaysToDate,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  differenceInCalendarWeeks,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  isWeekend,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
} from "date-fns"

import type { PeriodType, TimePeriod } from "../enums"

/**
 * Calendar rules on date-only values. Dates cross the boundary as ISO
 * `yyyy-MM-dd` strings (`IsoDate`), never as `Date` or timestamps, so no
 * timezone can shift a day. Functions throw `RangeError` on a malformed date;
 * validate user input with `isIsoDate` first.
 *
 * Allocation buckets ("periods"): a week starts on Monday, a month on the 1st,
 * a quarter on Jan, Apr, Jul or Oct 1. Working days are Monday to Friday.
 */

/** A calendar date as `yyyy-MM-dd`. */
export type IsoDate = string

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a real calendar date written as `yyyy-MM-dd`. */
export function isIsoDate(value: unknown): value is IsoDate {
  return typeof value === "string" && tryParse(value) !== null
}

/** Local-midnight `Date` for an ISO date, or null if it isn't a real date. */
function tryParse(value: string): Date | null {
  const match = ISO_DATE.exec(value)
  if (!match) return null
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  )
  return format(date) === value ? date : null
}

function parse(value: IsoDate): Date {
  const date = tryParse(value)
  if (!date) throw new RangeError(`Not an ISO date (yyyy-MM-dd): ${value}`)
  return date
}

function format(date: Date): IsoDate {
  const y = String(date.getFullYear()).padStart(4, "0")
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/** Negative, zero or positive as `a` is before, equal to or after `b`. */
export function compareDates(a: IsoDate, b: IsoDate): number {
  return daysBetween(b, a)
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return compareDates(a, b) <= 0 ? a : b
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return compareDates(a, b) >= 0 ? a : b
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return format(addDaysToDate(parse(date), days))
}

/** Calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return differenceInCalendarDays(parse(to), parse(from))
}

/** Monday–Friday days in the inclusive range; 0 when `end` precedes `start`. */
export function countWorkingDays(start: IsoDate, end: IsoDate): number {
  const total = daysBetween(start, end) + 1
  if (total <= 0) return 0
  const first = parse(start)
  const fullWeeks = Math.floor(total / 7)
  let count = fullWeeks * 5
  for (let i = fullWeeks * 7; i < total; i++) {
    if (!isWeekend(addDaysToDate(first, i))) count++
  }
  return count
}

/** The Allocation bucket for a Time Period: Days and Weeks both plan by week. */
export function periodTypeForTimePeriod(timePeriod: TimePeriod): PeriodType {
  switch (timePeriod) {
    case "days":
    case "weeks":
      return "week"
    case "months":
      return "month"
    case "quarters":
      return "quarter"
  }
}

/** First day of the bucket containing `date`. */
export function startOfPeriod(periodType: PeriodType, date: IsoDate): IsoDate {
  const d = parse(date)
  switch (periodType) {
    case "week":
      return format(startOfWeek(d, { weekStartsOn: 1 }))
    case "month":
      return format(startOfMonth(d))
    case "quarter":
      return format(startOfQuarter(d))
  }
}

/** Last day of the bucket containing `date`. */
export function endOfPeriod(periodType: PeriodType, date: IsoDate): IsoDate {
  const d = parse(date)
  switch (periodType) {
    case "week":
      return format(endOfWeek(d, { weekStartsOn: 1 }))
    case "month":
      return format(endOfMonth(d))
    case "quarter":
      return format(endOfQuarter(d))
  }
}

/** True when `date` is a bucket boundary (e.g. a Monday for weeks). */
export function isPeriodStart(periodType: PeriodType, date: IsoDate): boolean {
  return startOfPeriod(periodType, date) === date
}

/** The start of the bucket `count` buckets after the one containing `date`. */
export function addPeriods(
  periodType: PeriodType,
  date: IsoDate,
  count: number
): IsoDate {
  const start = parse(startOfPeriod(periodType, date))
  switch (periodType) {
    case "week":
      return format(addWeeks(start, count))
    case "month":
      return format(addMonths(start, count))
    case "quarter":
      return format(addMonths(start, count * 3))
  }
}

/** Signed number of whole buckets from the one containing `from` to `to`'s. */
export function periodsBetween(
  periodType: PeriodType,
  from: IsoDate,
  to: IsoDate
): number {
  const a = parse(from)
  const b = parse(to)
  switch (periodType) {
    case "week":
      return differenceInCalendarWeeks(b, a, { weekStartsOn: 1 })
    case "month":
      return differenceInCalendarMonths(b, a)
    case "quarter":
      return (
        differenceInCalendarMonths(startOfQuarter(b), startOfQuarter(a)) / 3
      )
  }
}

/** Starts of every bucket overlapping the inclusive range, in order. */
export function periodStartsInRange(
  periodType: PeriodType,
  start: IsoDate,
  end: IsoDate
): IsoDate[] {
  const starts: IsoDate[] = []
  if (compareDates(end, start) < 0) return starts
  const count = periodsBetween(periodType, start, end)
  for (let i = 0; i <= count; i++) starts.push(addPeriods(periodType, start, i))
  return starts
}
