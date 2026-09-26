/**
 * Display formatting shared by server and client components. Dates render in
 * UTC so the server and the browser produce the same text (no hydration
 * mismatch); a date-only display doesn't need the viewer's time zone.
 */
const DATE = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeZone: "UTC",
})

/** e.g. "Sep 23, 2026". */
export function formatDate(date: Date | string) {
  return DATE.format(typeof date === "string" ? new Date(date) : date)
}

const MONTH_DAY = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

/**
 * A compact inclusive range: "Oct 5 – Dec 31, 2026" within a year,
 * "Nov 2, 2026 – Feb 1, 2027" across years, one date when they are equal.
 */
export function formatDateRange(start: string, end: string) {
  if (start === end) return formatDate(start)
  if (start.slice(0, 4) !== end.slice(0, 4))
    return `${formatDate(start)} – ${formatDate(end)}`
  return `${MONTH_DAY.format(new Date(start))} – ${formatDate(end)}`
}

/** e.g. "Oct 5" (no year: the Timeline's axis shows it). */
export function formatMonthDay(date: string) {
  return MONTH_DAY.format(new Date(date))
}

const DATE_TIME = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
})

/** e.g. "Sep 23, 2026, 4:05 PM UTC" (UTC, like `formatDate`). */
export function formatDateTime(date: Date | string) {
  return `${DATE_TIME.format(typeof date === "string" ? new Date(date) : date)} UTC`
}

/** Whole days from `from` until `now` (never negative), e.g. how long a Quote has waited. */
export function daysSince(from: Date | string, now = new Date()) {
  const start = typeof from === "string" ? new Date(from) : from
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86_400_000))
}

/** Today in the viewer's time zone as `yyyy-MM-dd` (for date inputs). */
export function todayIsoDate(now = new Date()) {
  const y = String(now.getFullYear()).padStart(4, "0")
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/**
 * A `yyyy-MM-dd` day as the timestamp of that day's local midnight — what a
 * date picker (niko's date filter, react-day-picker) shows as that day.
 */
export function fromLocalDay(day: string | undefined): number | undefined {
  if (!day) return undefined
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y!, m! - 1, d!).getTime()
}

/** The local calendar day of a date picker's timestamp, as `yyyy-MM-dd`. */
export function toLocalDay(timestamp: number | undefined): string | undefined {
  return timestamp === undefined || timestamp === null
    ? undefined
    : todayIsoDate(new Date(timestamp))
}
