/**
 * Number and date formatting for Quote Documents, from the Organization's
 * currency and the document settings' locale and decimals. Values stay
 * decimal strings: they are rounded with `Decimal` (half-up) and handed to
 * `Intl` as strings, never through a float.
 *
 * The PDF uses the built-in Helvetica, which only has the WinAnsi (Latin-1
 * plus a few) characters, so `pdfText` swaps the spaces `Intl` uses in some
 * locales for ones it has, and money falls back to the ISO code when the
 * currency's symbol isn't printable (e.g. ₹ → "INR 1,234.00").
 */
import { currencyMinorUnit, Decimal } from "@workspace/domain/money"

/** WinAnsi's characters above Latin-1's printable range (0x80–0x9f slots). */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""))

/** Can Helvetica (WinAnsi) print every character of `text`? */
export function isPdfPrintable(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code === 0x0a || code === 0x09) continue
    if (code >= 0x20 && code <= 0x7e) continue
    if (code >= 0xa0 && code <= 0xff) continue
    if (WIN_ANSI_EXTRA.has(char)) continue
    return false
  }
  return true
}

/** Replaces the narrow/thin spaces some locales use with a no-break space. */
export function pdfText(text: string): string {
  return text.replace(/[\u2009\u202f]/g, "\u00a0").replace(/\u2212/g, "-")
}

export interface MoneyFormatOptions {
  locale: string
  /** Decimal places, or `null` for the currency's minor unit. */
  decimals: number | null
}

/** "1234.5000" in USD, en-US → "$1,234.50". */
export function formatDocumentMoney(
  amount: string,
  currency: string,
  { locale, decimals }: MoneyFormatOptions
): string {
  const places = decimals ?? currencyMinorUnit(currency)
  const rounded = new Decimal(amount).toFixed(places, Decimal.ROUND_HALF_UP)
  const format = (currencyDisplay: "symbol" | "code") =>
    pdfText(
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        currencyDisplay,
        minimumFractionDigits: places,
        maximumFractionDigits: places,
        // Intl formats decimal strings exactly (ES2023).
      }).format(rounded as unknown as number)
    )
  const symbol = format("symbol")
  return isPdfPrintable(symbol) ? symbol : format("code")
}

/** "40.000" with 2 decimals → "40.00"; grouping per locale. */
export function formatDocumentQuantity(
  quantity: string,
  { locale, decimals }: { locale: string; decimals: number }
): string {
  const rounded = new Decimal(quantity).toFixed(decimals, Decimal.ROUND_HALF_UP)
  return pdfText(
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(rounded as unknown as number)
  )
}

/** "12.5000" → "12.5%" (up to 4 decimals, trailing zeros dropped). */
export function formatDocumentPercent(value: string, locale: string): string {
  return pdfText(
    new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 4,
    }).format(new Decimal(value).div(100).toString() as unknown as number)
  )
}

/** "2026-10-01" (or an ISO timestamp) → "Oct 1, 2026" in `locale`, UTC. */
export function formatDocumentDate(iso: string, locale: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return pdfText(
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(date)
  )
}
