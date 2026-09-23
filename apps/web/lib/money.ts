/**
 * Money display and input helpers. Amounts stay decimal strings end to end
 * (ADR-0002): they are formatted from the string, never parsed to a float.
 */

/** A money amount as typed: digits with up to 4 decimals, nothing else. */
export const MONEY_INPUT = /^\d{1,15}(\.\d{1,4})?$/

export function isMoneyInput(value: string) {
  return MONEY_INPUT.test(value.trim())
}

/**
 * "1234.5000" → "$1,234.50" in `currency`. Intl formats the decimal string
 * exactly (no float round trip); `maximumFractionDigits` keeps sub-cent
 * rates such as "0.1250" visible.
 */
export function formatMoney(
  amount: string,
  currency: string,
  locale = "en-US"
) {
  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 4,
  })
  // Intl accepts decimal strings exactly (ES2023); the cast keeps older
  // lib typings happy.
  return format.format(amount as unknown as number)
}

/** "150.0000" → "150", "12.5000" → "12.5": for editing a stored amount. */
export function trimMoney(amount: string) {
  return amount.includes(".") ? amount.replace(/\.?0+$/, "") : amount
}
