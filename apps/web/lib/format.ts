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
