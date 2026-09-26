import type { IsoDate } from "../dates"

/**
 * Quote naming. A Quote's Name is required, user-chosen and not unique;
 * nothing is auto-numbered. The create dialog prefills a suggestion.
 */

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
] as const

/** The longest Quote Name the API accepts. */
export const QUOTE_NAME_MAX = 200

/**
 * The suggested Name for a new Quote: "{Customer} – {Mon YYYY}" of the Quote
 * Start Date (e.g. "Initech – Oct 2026"), or just the month without an
 * Customer. Trimmed to `QUOTE_NAME_MAX`.
 */
export function suggestQuoteName(
  customerName: string | null | undefined,
  startDate: IsoDate
): string {
  const [year, month] = startDate.split("-")
  const period = `${MONTHS[Number(month) - 1] ?? ""} ${year ?? ""}`.trim()
  const customer = customerName?.trim()
  if (!customer) return period
  const suffix = ` – ${period}`
  return customer.slice(0, QUOTE_NAME_MAX - suffix.length) + suffix
}

/** Names compare ignoring case and surrounding spaces (the duplicate warning). */
export function sameQuoteName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
