/**
 * Customer rules: the Organization-managed value lists that classify a
 * Customer (glossary: Customer Type / Industry). Both are optional on a
 * Customer. A value in use can only be retired (kept where set, no longer
 * offered); an unused value can be deleted; a rename shows everywhere.
 */
import type { CustomerClassificationKind } from "../enums"
import { CUSTOMER_CLASSIFICATION_KIND_LABELS } from "../enums"

/** The longest Customer Type or Industry name. */
export const CUSTOMER_CLASSIFICATION_NAME_MAX = 100

/** The most values one list may hold. */
export const CUSTOMER_CLASSIFICATIONS_PER_KIND_MAX = 200

/** The Customer Types a new Organization starts with, in order. */
export const DEFAULT_CUSTOMER_TYPES = [
  "Prospect",
  "Customer",
  "Partner",
] as const

/** The Industries a new Organization starts with, in order. */
export const DEFAULT_INDUSTRIES = [
  "Construction",
  "Education",
  "Energy & Utilities",
  "Financial Services",
  "Government",
  "Healthcare",
  "Manufacturing",
  "Media & Entertainment",
  "Nonprofit",
  "Professional Services",
  "Real Estate",
  "Retail",
  "Technology",
  "Telecommunications",
  "Transportation & Logistics",
] as const

/** Each list's defaults, for an Organization that has no values of it. */
export const DEFAULT_CUSTOMER_CLASSIFICATIONS: Record<
  CustomerClassificationKind,
  readonly string[]
> = {
  customer_type: DEFAULT_CUSTOMER_TYPES,
  industry: DEFAULT_INDUSTRIES,
}

/** Whether two names are the same value (trimmed, ignoring case). */
export function sameClassificationName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export type ClassificationNameCheck =
  | { ok: true; name: string }
  | { ok: false; reason: "blank" | "too_long" | "duplicate"; message: string }

/**
 * Checks a Customer Type or Industry name: trimmed, not blank, at most
 * `CUSTOMER_CLASSIFICATION_NAME_MAX` characters, and not one of `taken`
 * (the other values of the same list, compared with
 * `sameClassificationName`). Returns the trimmed name.
 */
export function checkClassificationName(
  kind: CustomerClassificationKind,
  name: string,
  taken: readonly string[] = []
): ClassificationNameCheck {
  const trimmed = name.trim()
  if (!trimmed) {
    return { ok: false, reason: "blank", message: "Enter a name." }
  }
  if (trimmed.length > CUSTOMER_CLASSIFICATION_NAME_MAX) {
    return {
      ok: false,
      reason: "too_long",
      message: `Use at most ${CUSTOMER_CLASSIFICATION_NAME_MAX} characters.`,
    }
  }
  if (taken.some((other) => sameClassificationName(other, trimmed))) {
    return {
      ok: false,
      reason: "duplicate",
      message: `${CUSTOMER_CLASSIFICATION_KIND_LABELS[kind].singular} “${trimmed}” already exists.`,
    }
  }
  return { ok: true, name: trimmed }
}

/** A value as a picker sees it. */
export interface ClassificationOption {
  id: string
  retired: boolean
}

/**
 * The values a Customer's picker offers, in list order: every value that
 * isn't retired, plus `currentId` (the Customer's own value) even when
 * retired, so it stays until changed.
 */
export function selectableClassifications<T extends ClassificationOption>(
  values: readonly T[],
  currentId: string | null | undefined
): T[] {
  return values.filter((value) => !value.retired || value.id === currentId)
}

export type ClassificationChoice =
  | { ok: true }
  | { ok: false; reason: "retired"; message: string }

/**
 * Whether a Customer may be given `value`: a retired value is no longer
 * offered, but a Customer that already has it keeps it (`currentId`).
 */
export function canChooseClassification(
  kind: CustomerClassificationKind,
  value: { id: string; name: string; retired: boolean },
  currentId: string | null | undefined
): ClassificationChoice {
  if (value.retired && value.id !== currentId) {
    return {
      ok: false,
      reason: "retired",
      message: `${CUSTOMER_CLASSIFICATION_KIND_LABELS[kind].singular} “${value.name}” is retired. Pick another value.`,
    }
  }
  return { ok: true }
}
