import { Decimal } from "decimal.js"

import type { LabelTerm } from "../enums"
import { LABEL_TERMS } from "../enums"
import type { DecimalInput } from "../money"
import { DEFAULT_HOURS_PER_DAY } from "../pricing"

/**
 * Organization settings rules: Hours Per Day, Label Overrides and the logo.
 * (The deletable-status rules live in `policy`: `checkDeletableStatuses`,
 * `DELETABLE_STATUS_OPTIONS`, `DEFAULT_DELETABLE_STATUSES`.) The API
 * validates every settings command with these, and the Settings forms use the
 * same functions so they agree.
 */

// ─── Hours Per Day ──────────────────────────────────────────────────────────

/** Hours Per Day is stored as `numeric(4,2)`: more than 0, at most 24. */
export const HOURS_PER_DAY_MAX = 24
export const HOURS_PER_DAY_SCALE = 2

export type HoursPerDayCheck =
  | { ok: true; /** At storage scale, e.g. "7.50". */ value: string }
  | {
      ok: false
      reason: "hours_per_day_invalid" | "hours_per_day_range"
      message: string
    }

/** Validates an Hours Per Day entry and normalises it to storage scale. */
export function checkHoursPerDay(
  input: DecimalInput | null | undefined
): HoursPerDayCheck {
  let value: Decimal
  try {
    if (input === null || input === undefined || String(input).trim() === "") {
      throw new Error("empty")
    }
    value = new Decimal(typeof input === "string" ? input.trim() : input)
    if (!value.isFinite()) throw new Error("not finite")
  } catch {
    return {
      ok: false,
      reason: "hours_per_day_invalid",
      message: "Enter a number of hours.",
    }
  }
  if (value.lte(0) || value.gt(HOURS_PER_DAY_MAX)) {
    return {
      ok: false,
      reason: "hours_per_day_range",
      message: `Hours Per Day must be more than 0 and at most ${HOURS_PER_DAY_MAX}.`,
    }
  }
  if (value.decimalPlaces() > HOURS_PER_DAY_SCALE) {
    return {
      ok: false,
      reason: "hours_per_day_invalid",
      message: `Use at most ${HOURS_PER_DAY_SCALE} decimal places.`,
    }
  }
  return { ok: true, value: value.toFixed(HOURS_PER_DAY_SCALE) }
}

/** The Hours Per Day a new Organization starts with, at storage scale. */
export const DEFAULT_HOURS_PER_DAY_VALUE = new Decimal(
  DEFAULT_HOURS_PER_DAY
).toFixed(HOURS_PER_DAY_SCALE)

// ─── Label Overrides ────────────────────────────────────────────────────────

export interface TermLabel {
  singular: string
  plural: string
}

/** The canonical names, shown when an Organization hasn't overridden a term. */
export const DEFAULT_LABELS: Record<LabelTerm, TermLabel> = {
  resource_role: { singular: "Resource Role", plural: "Resource Roles" },
  product: { singular: "Product", plural: "Products" },
  add_on: { singular: "Add-on", plural: "Add-ons" },
  phase: { singular: "Phase", plural: "Phases" },
}

/**
 * Terms an Organization may hide entirely (it doesn't sell them). Resource
 * Roles and Phases are the backbone of a Quote, so they can only be renamed.
 */
export const HIDEABLE_LABEL_TERMS: readonly LabelTerm[] = ["product", "add_on"]

export function canHideTerm(term: LabelTerm): boolean {
  return HIDEABLE_LABEL_TERMS.includes(term)
}

export const LABEL_MAX_LENGTH = 40

/** One stored Label Override. `null` names fall back to the canonical name. */
export interface LabelOverride {
  term: LabelTerm
  singular: string | null
  plural: string | null
  enabled: boolean
}

/** Every term's display names and whether it is shown. */
export type Labels = Record<LabelTerm, TermLabel & { enabled: boolean }>

/**
 * The labels the UI shows: each term's override where one is set, the
 * canonical name otherwise. Terms that can't be hidden are always enabled.
 */
export function resolveLabels(
  overrides: readonly LabelOverride[] = []
): Labels {
  const byTerm = new Map(overrides.map((o) => [o.term, o]))
  return Object.fromEntries(
    LABEL_TERMS.map((term) => {
      const override = byTerm.get(term)
      return [
        term,
        {
          singular: override?.singular || DEFAULT_LABELS[term].singular,
          plural: override?.plural || DEFAULT_LABELS[term].plural,
          enabled: canHideTerm(term) ? (override?.enabled ?? true) : true,
        },
      ]
    })
  ) as Labels
}

export type LabelOverrideCheck =
  | { ok: true; value: LabelOverride }
  | {
      ok: false
      reason: "label_too_long" | "term_not_hideable"
      field: "singular" | "plural" | "enabled"
      message: string
    }

/**
 * Validates one Label Override and normalises it for storage: names are
 * trimmed, and a blank name or one equal to the canonical name is stored as
 * `null` (no override).
 */
export function checkLabelOverride(input: {
  term: LabelTerm
  singular?: string | null
  plural?: string | null
  enabled?: boolean
}): LabelOverrideCheck {
  const names = { singular: input.singular, plural: input.plural }
  const normalized: Record<"singular" | "plural", string | null> = {
    singular: null,
    plural: null,
  }
  for (const field of ["singular", "plural"] as const) {
    const name = (names[field] ?? "").trim().replace(/\s+/g, " ")
    if (name.length > LABEL_MAX_LENGTH) {
      return {
        ok: false,
        reason: "label_too_long",
        field,
        message: `Use at most ${LABEL_MAX_LENGTH} characters.`,
      }
    }
    normalized[field] =
      name === "" || name === DEFAULT_LABELS[input.term][field] ? null : name
  }
  const enabled = input.enabled ?? true
  if (!enabled && !canHideTerm(input.term)) {
    return {
      ok: false,
      reason: "term_not_hideable",
      field: "enabled",
      message: `${DEFAULT_LABELS[input.term].plural} can be renamed but not hidden.`,
    }
  }
  return { ok: true, value: { term: input.term, ...normalized, enabled } }
}

// ─── Logo ───────────────────────────────────────────────────────────────────

/** Accepted logo file types → the extension the stored object gets. */
export const LOGO_CONTENT_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
} as const
export type LogoContentType = keyof typeof LOGO_CONTENT_TYPES

/** 2 MB. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024

export function isLogoContentType(type: string): type is LogoContentType {
  return Object.hasOwn(LOGO_CONTENT_TYPES, type)
}

export type LogoFileCheck =
  | { ok: true; contentType: LogoContentType; extension: string }
  | {
      ok: false
      reason: "logo_type" | "logo_size"
      message: string
    }

/** Whether a file may be the Organization's logo (type and size). */
export function checkLogoFile(file: {
  contentType: string | null | undefined
  size: number
}): LogoFileCheck {
  const contentType = file.contentType?.split(";")[0]?.trim().toLowerCase()
  if (!contentType || !isLogoContentType(contentType)) {
    return {
      ok: false,
      reason: "logo_type",
      message: "Upload a PNG, JPEG, SVG or WebP image.",
    }
  }
  if (!Number.isInteger(file.size) || file.size <= 0) {
    return { ok: false, reason: "logo_size", message: "The file is empty." }
  }
  if (file.size > LOGO_MAX_BYTES) {
    return {
      ok: false,
      reason: "logo_size",
      message: `The logo must be at most ${LOGO_MAX_BYTES / 1024 / 1024} MB.`,
    }
  }
  return {
    ok: true,
    contentType,
    extension: LOGO_CONTENT_TYPES[contentType],
  }
}
