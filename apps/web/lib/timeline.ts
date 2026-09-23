/**
 * The Timeline View's scale: which days it shows, where a date or a bar
 * falls on it (as fractions of the width, so the Gantt lays out with CSS
 * percentages), and the tick marks along the top. Dates are ISO
 * `yyyy-MM-dd` strings; all maths is in whole calendar days.
 */
import {
  addDays,
  compareDates,
  daysBetween,
  maxDate,
  minDate,
} from "@workspace/domain/dates"
import type { IsoDate } from "@workspace/domain/dates"

/** The inclusive range of days the Timeline shows. */
export interface TimelineRange {
  start: IsoDate
  end: IsoDate
  /** Number of days shown (end − start + 1). */
  days: number
}

/**
 * The Quote's dates, widened to cover every line and Milestone (a
 * Milestone may fall outside the Quote dates).
 */
export function timelineRange(
  quote: { startDate: IsoDate; endDate: IsoDate },
  spans: readonly { startDate: IsoDate; endDate: IsoDate }[],
  dates: readonly IsoDate[]
): TimelineRange {
  let start = quote.startDate
  let end = quote.endDate
  for (const span of spans) {
    start = minDate(start, span.startDate)
    end = maxDate(end, span.endDate)
  }
  for (const date of dates) {
    start = minDate(start, date)
    end = maxDate(end, date)
  }
  return { start, end, days: daysBetween(start, end) + 1 }
}

/** Where the start of `date` falls, 0 (range start) … 1 (after range end). */
export function dateOffset(range: TimelineRange, date: IsoDate): number {
  return daysBetween(range.start, date) / range.days
}

/** A bar covering `start`…`end` inclusive, as `{ left, width }` fractions. */
export function barSpan(
  range: TimelineRange,
  start: IsoDate,
  end: IsoDate
): { left: number; width: number } {
  const left = dateOffset(range, start)
  const width = (daysBetween(start, end) + 1) / range.days
  return { left, width }
}

/** The middle of `date`'s day (where a Milestone marker sits). */
export function dayCentre(range: TimelineRange, date: IsoDate): number {
  return (daysBetween(range.start, date) + 0.5) / range.days
}

export interface TimelineTick {
  date: IsoDate
  offset: number
  label: string
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

/**
 * Tick marks: every month start in the range (labelled "Oct 2026" for
 * January and the first tick, else "Nov"), or, for a range of under ~10
 * weeks, every Monday (labelled "5 Oct"). The range start always gets a
 * tick.
 */
export function timelineTicks(range: TimelineRange): TimelineTick[] {
  const ticks: TimelineTick[] = []
  if (range.days <= 70) {
    let date = range.start
    // Advance to the first Monday on or after the start.
    while (new Date(`${date}T00:00:00Z`).getUTCDay() !== 1) {
      date = addDays(date, 1)
    }
    for (; compareDates(date, range.end) <= 0; date = addDays(date, 7)) {
      const [, m, d] = date.split("-").map(Number)
      ticks.push({
        date,
        offset: dateOffset(range, date),
        label: `${d} ${MONTHS[m! - 1]}`,
      })
    }
    return ticks
  }
  const [y0, m0] = range.start.split("-").map(Number)
  let year = y0!
  let month = m0!
  for (;;) {
    const date = `${year}-${String(month).padStart(2, "0")}-01`
    if (compareDates(date, range.end) > 0) break
    const first = ticks.length === 0
    const shown = compareDates(date, range.start) < 0 ? range.start : date
    ticks.push({
      date: shown,
      offset: dateOffset(range, shown),
      label:
        first || month === 1
          ? `${MONTHS[month - 1]} ${year}`
          : MONTHS[month - 1]!,
    })
    month++
    if (month > 12) {
      month = 1
      year++
    }
  }
  return ticks
}
