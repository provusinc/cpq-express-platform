import { Decimal } from "decimal.js"

/**
 * Decimal arithmetic and rounding (ADR-0002). Never use JS `number`
 * arithmetic for money, percentages or quantities.
 *
 * Boundary convention for the whole domain package:
 * - **Inputs** accept `DecimalInput` (`string | number | Decimal`). Pass the
 *   strings Postgres returns for `numeric` columns straight in.
 * - **Outputs** are strings at the storage scale of their column, exactly as
 *   Postgres would return them: money `numeric(19,4)` → 4 dp ("1234.5000"),
 *   percentages `numeric(7,4)` → 4 dp ("25.0000"), quantities and Allocation
 *   amounts `numeric(18,3)` → 3 dp ("40.000"). Compare them with `Decimal`, or
 *   as strings against values read back from the database.
 * - Rounding is always half-up (commercial rounding).
 */
export { Decimal }

/** Anything the domain accepts as a decimal value. */
export type DecimalInput = Decimal.Value

/** Storage scales (fraction digits) of the numeric column families. */
export const MONEY_SCALE = 4
export const PERCENT_SCALE = 4
export const QUANTITY_SCALE = 3

const HALF_UP = Decimal.ROUND_HALF_UP

/** Wrap a value as a `Decimal`. Throws on anything that is not a number. */
export function toDecimal(value: DecimalInput): Decimal {
  return new Decimal(value)
}

/** Exact sum of decimal values (0 for an empty list). */
export function sumDecimals(values: Iterable<DecimalInput>): Decimal {
  let sum = new Decimal(0)
  for (const value of values) sum = sum.plus(value)
  return sum
}

const minorUnitCache = new Map<string, number>()

/**
 * Number of fraction digits in a currency's minor unit (USD 2, JPY 0, KWD 3),
 * from the ISO 4217 data built into `Intl`. Throws for an unknown code.
 */
export function currencyMinorUnit(currencyCode: string): number {
  const code = currencyCode.toUpperCase()
  const cached = minorUnitCache.get(code)
  if (cached !== undefined) return cached
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new RangeError(`Unknown currency code: ${currencyCode}`)
  }
  const digits = new Intl.NumberFormat("en", {
    style: "currency",
    currency: code,
  }).resolvedOptions().maximumFractionDigits
  if (digits === undefined) {
    throw new RangeError(`Unknown currency code: ${currencyCode}`)
  }
  minorUnitCache.set(code, digits)
  return digits
}

/** Round half-up to the currency's minor unit (e.g. cents). */
export function roundToMinorUnit(
  value: DecimalInput,
  currencyCode: string
): Decimal {
  return new Decimal(value).toDecimalPlaces(
    currencyMinorUnit(currencyCode),
    HALF_UP
  )
}

/** Money as stored: `numeric(19,4)` string, e.g. "1234.5000". */
export function toMoneyString(value: DecimalInput): string {
  return new Decimal(value).toFixed(MONEY_SCALE, HALF_UP)
}

/** Percentage as stored: `numeric(7,4)` string, e.g. "25.0000" for 25 %. */
export function toPercentString(value: DecimalInput): string {
  return new Decimal(value).toFixed(PERCENT_SCALE, HALF_UP)
}

/** Quantity or Allocation amount as stored: `numeric(18,3)`, e.g. "40.000". */
export function toQuantityString(value: DecimalInput): string {
  return new Decimal(value).toFixed(QUANTITY_SCALE, HALF_UP)
}
