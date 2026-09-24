/**
 * Organization provisioning rules: the subdomain slug and the currency.
 * The database enforces the same rules with check constraints (built from
 * these constants), and `apps/web/lib/hosts.ts` resolves subdomains with them.
 */

/** Subdomains that are never an Organization (ADR-0001). */
export const RESERVED_SLUGS = [
  "app",
  "admin",
  "www",
  "api",
  "auth",
  "docs",
  "status",
] as const
export type ReservedSlug = (typeof RESERVED_SLUGS)[number]

/**
 * A DNS label: lowercase letters, digits and inner hyphens, 1–63 chars.
 * A string (not a RegExp) so the database check constraint can embed it.
 */
export const SLUG_PATTERN = "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$"
const SLUG = new RegExp(SLUG_PATTERN)

export function isReservedSlug(slug: string): slug is ReservedSlug {
  return (RESERVED_SLUGS as readonly string[]).includes(slug)
}

export type SlugCheck =
  | { ok: true }
  | { ok: false; reason: "slug_format" | "slug_reserved"; message: string }

/**
 * Whether `slug` may name a new Organization (format and reserved list;
 * uniqueness is the API's job). Slugs are immutable once created.
 */
export function checkSlug(slug: string): SlugCheck {
  if (!SLUG.test(slug)) {
    return {
      ok: false,
      reason: "slug_format",
      message:
        "Use 1–63 lowercase letters, digits or hyphens, starting and ending with a letter or digit.",
    }
  }
  if (isReservedSlug(slug)) {
    return {
      ok: false,
      reason: "slug_reserved",
      message: `"${slug}" is reserved for CPQ Express itself.`,
    }
  }
  return { ok: true }
}

/** Whether `code` is an ISO 4217 currency code this runtime knows. */
export function isCurrencyCode(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false
  return supportedCurrencies().includes(code)
}

let currencies: readonly string[] | undefined

/** ISO 4217 codes known to `Intl`, alphabetically (for currency pickers). */
export function supportedCurrencies(): readonly string[] {
  currencies ??= Intl.supportedValuesOf("currency")
  return currencies
}

/**
 * A slug suggestion for an Organization name ("Acme Corp." → "acme-corp"):
 * lowercase ASCII letters and digits joined by single hyphens, at most 63
 * characters. It may still be reserved or taken; run `checkSlug` on it.
 */
export function suggestSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "")
}
