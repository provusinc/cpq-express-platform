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

/** Today in the viewer's time zone as `yyyy-MM-dd` (for date inputs). */
export function todayIsoDate(now = new Date()) {
  const y = String(now.getFullYear()).padStart(4, "0")
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}
