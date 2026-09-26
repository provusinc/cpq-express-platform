/**
 * The Quote header's figures, as pure helpers: the Customer monogram, the
 * margin tone, compact Effort and the Quote's Duration. Money stays decimal
 * strings (ADR-0002); only display rounding happens here.
 */
import { daysBetween } from "@workspace/domain/dates"
import type { IsoDate } from "@workspace/domain/dates"
import { LOW_MARGIN_THRESHOLD } from "@workspace/domain/insights"
import { Decimal } from "@workspace/domain/money"

/** "Acme Corp Express" → "AC", "globex" → "G": up to two initials. */
export function initials(name: string) {
  const words = name
    .split(/[\s\-–—_/&.,]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("")
}

export type MarginTone = "success" | "warning" | "danger" | "neutral"

/**
 * How a Margin % reads: neutral without a Total, danger when negative,
 * warning under the low-margin line (`LOW_MARGIN_THRESHOLD`), else success.
 */
export function marginTone(total: string, marginPct: string): MarginTone {
  if (new Decimal(total).isZero()) return "neutral"
  const pct = new Decimal(marginPct)
  if (pct.isNegative()) return "danger"
  return pct.lessThan(LOW_MARGIN_THRESHOLD) ? "warning" : "success"
}

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

/** Hours as a figure: "1,120" below ten thousand, else "12.3K". */
export function compactHours(hours: string) {
  const value = new Decimal(hours)
  return value.lessThan(10_000)
    ? WHOLE.format(value.toFixed(0) as unknown as number)
    : COMPACT.format(value.toNumber())
}

/** Σ quantity of the hourly Line Items: the Quote's Effort in hours. */
export function effortHours(
  lines: readonly { billingUnit: string; quantity: string }[]
) {
  return lines
    .filter((l) => l.billingUnit === "hour")
    .reduce((sum, l) => sum.plus(l.quantity), new Decimal(0))
    .toFixed(3)
}

/**
 * The Quote dates' length, both days inclusive: whole weeks ("26 wks"),
 * or days below two weeks ("9 days").
 */
export function quoteDuration(startDate: IsoDate, endDate: IsoDate) {
  const days = daysBetween(startDate, endDate) + 1
  if (days < 14) return { value: days, unit: days === 1 ? "day" : "days" }
  const weeks = Math.round(days / 7)
  return { value: weeks, unit: weeks === 1 ? "wk" : "wks" }
}
