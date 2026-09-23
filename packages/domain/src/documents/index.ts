import type { Actor, QuoteFacts } from "../policy"

/**
 * Quote Document rules: the document settings an Admin sets (format,
 * colours, section order and visibility, decimals, locale, footer, terms),
 * their validation and defaults, and who may delete a Quote Document. The
 * API validates `settings.updateDocuments` with `checkDocumentSettings`, and
 * the Settings form uses the same function so they agree.
 */

/** Standard (roomy, with descriptions and dates) or compact (dense). */
export const DOCUMENT_FORMATS = ["standard", "compact"] as const
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number]

export const DOCUMENT_FORMAT_LABELS: Record<DocumentFormat, string> = {
  standard: "Standard",
  compact: "Compact",
}

/** The sections of a Quote Document, in their default order. */
export const DOCUMENT_SECTIONS = [
  "header",
  "bill_to",
  "overview",
  "line_items",
  "summary",
  "milestones",
  "terms",
  "footer",
] as const
export type DocumentSection = (typeof DOCUMENT_SECTIONS)[number]

export const DOCUMENT_SECTION_LABELS: Record<DocumentSection, string> = {
  header: "Header",
  bill_to: "Bill To",
  overview: "Overview",
  line_items: "Line Items",
  summary: "Summary",
  milestones: "Milestones",
  terms: "Terms",
  footer: "Footer",
}

/** One section's place in the document: listed in order, shown or hidden. */
export interface DocumentSectionSetting {
  section: DocumentSection
  visible: boolean
}

/** Money is shown with 0–4 decimals, quantities with 0–3. */
export const MONEY_DECIMALS_MAX = 4
export const QUANTITY_DECIMALS_MAX = 3
export const FOOTER_TEXT_MAX = 500
export const TERMS_MAX = 10_000

/** An Organization's document settings (glossary: Quote Document). */
export interface DocumentSettings {
  format: DocumentFormat
  /** `#rrggbb`, lowercase: headings, rules, the header band. */
  primaryColor: string
  /** `#rrggbb`, lowercase: the Total and highlights. */
  accentColor: string
  /** Every section exactly once, in document order. */
  sections: DocumentSectionSetting[]
  /**
   * Decimal places for money on the document (rounded half-up), or `null`
   * for the currency's minor unit (USD 2, JPY 0).
   */
  moneyDecimals: number | null
  /** Decimal places for quantities (rounded half-up). */
  quantityDecimals: number
  /** BCP 47 locale for number and date formatting, e.g. "en-US". */
  locale: string
  /** Printed at the bottom of every page, or `null` for none. */
  footerText: string | null
  /** The Terms section's text (plain text, line breaks kept), or `null`. */
  terms: string | null
}

export const DEFAULT_DOCUMENT_LOCALE = "en-US"

/** What an Organization's documents look like until an Admin saves settings. */
export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettings = {
  format: "standard",
  primaryColor: "#1f2937",
  accentColor: "#2563eb",
  sections: DOCUMENT_SECTIONS.map((section) => ({ section, visible: true })),
  moneyDecimals: null,
  quantityDecimals: 2,
  locale: DEFAULT_DOCUMENT_LOCALE,
  footerText: null,
  terms: null,
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** `#abc` / `#AABBCC` → `#aabbcc`; `null` when it isn't a hex colour. */
export function normalizeHexColor(input: string): string | null {
  const value = input.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value)
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
  }
  return HEX_COLOR.test(value) ? value.toLowerCase() : null
}

/** Is `locale` a BCP 47 tag this runtime can format numbers and dates in? */
export function isSupportedLocale(locale: string): boolean {
  try {
    return (
      Intl.NumberFormat.supportedLocalesOf([locale]).length > 0 &&
      Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0
    )
  } catch {
    return false
  }
}

/**
 * Completes a section list: keeps the given order (first occurrence wins),
 * then appends any section left out, visible, in default order.
 */
export function completeSections(
  sections: readonly DocumentSectionSetting[]
): DocumentSectionSetting[] {
  const seen = new Set<DocumentSection>()
  const out: DocumentSectionSetting[] = []
  for (const s of sections) {
    if (seen.has(s.section)) continue
    seen.add(s.section)
    out.push({ section: s.section, visible: s.visible })
  }
  for (const section of DOCUMENT_SECTIONS) {
    if (!seen.has(section)) out.push({ section, visible: true })
  }
  return out
}

/** Stored form of the section list: the order and the hidden ones. */
export function sectionsToColumns(sections: readonly DocumentSectionSetting[]) {
  const complete = completeSections(sections)
  return {
    sectionOrder: complete.map((s) => s.section),
    hiddenSections: complete.filter((s) => !s.visible).map((s) => s.section),
  }
}

/** The section list from its stored form (`sectionsToColumns`). */
export function sectionsFromColumns(
  sectionOrder: readonly DocumentSection[],
  hiddenSections: readonly DocumentSection[]
): DocumentSectionSetting[] {
  const hidden = new Set(hiddenSections)
  return completeSections(
    sectionOrder.map((section) => ({ section, visible: !hidden.has(section) }))
  ).map((s) => ({ ...s, visible: !hidden.has(s.section) }))
}

export type DocumentSettingsField =
  | "format"
  | "primaryColor"
  | "accentColor"
  | "sections"
  | "moneyDecimals"
  | "quantityDecimals"
  | "locale"
  | "footerText"
  | "terms"

export type DocumentSettingsCheck =
  | { ok: true; value: DocumentSettings }
  | {
      ok: false
      reason: "document_settings_invalid"
      field: DocumentSettingsField
      message: string
    }

export interface DocumentSettingsInput {
  format: DocumentFormat
  primaryColor: string
  accentColor: string
  sections: readonly DocumentSectionSetting[]
  moneyDecimals: number | null
  quantityDecimals: number
  locale: string
  footerText?: string | null
  terms?: string | null
}

function isDecimals(value: number, max: number) {
  return Number.isInteger(value) && value >= 0 && value <= max
}

/**
 * Validates document settings and normalises them for storage: colours to
 * lowercase `#rrggbb`, the section list completed (every section once),
 * blank footer and terms to `null`, text trimmed.
 */
export function checkDocumentSettings(
  input: DocumentSettingsInput
): DocumentSettingsCheck {
  const fail = (
    field: DocumentSettingsField,
    message: string
  ): DocumentSettingsCheck => ({
    ok: false,
    reason: "document_settings_invalid",
    field,
    message,
  })
  if (!DOCUMENT_FORMATS.includes(input.format)) {
    return fail("format", "Choose Standard or Compact.")
  }
  const primaryColor = normalizeHexColor(input.primaryColor)
  if (!primaryColor) {
    return fail("primaryColor", "Enter a hex colour such as #1f2937.")
  }
  const accentColor = normalizeHexColor(input.accentColor)
  if (!accentColor) {
    return fail("accentColor", "Enter a hex colour such as #2563eb.")
  }
  const names = input.sections.map((s) => s.section)
  if (names.some((name) => !DOCUMENT_SECTIONS.includes(name))) {
    return fail("sections", "Unknown document section.")
  }
  if (new Set(names).size !== names.length) {
    return fail("sections", "List each section at most once.")
  }
  if (
    input.moneyDecimals !== null &&
    !isDecimals(input.moneyDecimals, MONEY_DECIMALS_MAX)
  ) {
    return fail(
      "moneyDecimals",
      `Use 0 to ${MONEY_DECIMALS_MAX} decimal places, or the currency's.`
    )
  }
  if (!isDecimals(input.quantityDecimals, QUANTITY_DECIMALS_MAX)) {
    return fail(
      "quantityDecimals",
      `Use 0 to ${QUANTITY_DECIMALS_MAX} decimal places.`
    )
  }
  const locale = input.locale.trim()
  if (!locale || !isSupportedLocale(locale)) {
    return fail("locale", "Enter a locale such as en-US, en-GB or de-DE.")
  }
  const footerText = (input.footerText ?? "").trim()
  if (footerText.length > FOOTER_TEXT_MAX) {
    return fail("footerText", `Use at most ${FOOTER_TEXT_MAX} characters.`)
  }
  const terms = (input.terms ?? "").trim()
  if (terms.length > TERMS_MAX) {
    return fail("terms", `Use at most ${TERMS_MAX} characters.`)
  }
  return {
    ok: true,
    value: {
      format: input.format,
      primaryColor,
      accentColor,
      sections: completeSections(input.sections),
      moneyDecimals: input.moneyDecimals,
      quantityDecimals: input.quantityDecimals,
      locale: Intl.getCanonicalLocales(locale)[0] ?? locale,
      footerText: footerText || null,
      terms: terms || null,
    },
  }
}

// ─── Permission ─────────────────────────────────────────────────────────────

export type QuoteDocumentDeleteDecision =
  | { allowed: true }
  | {
      allowed: false
      /** Who is asking (→ FORBIDDEN) or the Document's state (→ PRECONDITION_FAILED). */
      reason: "owner_or_admin_only" | "document_captured"
      message: string
    }

/**
 * May `actor` delete a Quote Document of this Quote? The Quote Owner or an
 * Admin, never one captured by Mark as Sent (it is the record of what the
 * customer received). Generating, listing and downloading are open to every
 * member who can see the Quote.
 */
export function canDeleteQuoteDocument(
  actor: Actor,
  quote: Pick<QuoteFacts, "ownerId">,
  document: { capturedByMarkSent: boolean }
): QuoteDocumentDeleteDecision {
  if (actor.role !== "admin" && actor.userId !== quote.ownerId) {
    return {
      allowed: false,
      reason: "owner_or_admin_only",
      message: "Only the Quote Owner or an Admin can delete a Quote Document.",
    }
  }
  if (document.capturedByMarkSent) {
    return {
      allowed: false,
      reason: "document_captured",
      message:
        "This Quote Document was captured by Mark as Sent and can't be deleted.",
    }
  }
  return { allowed: true }
}
