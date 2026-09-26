/**
 * Catalog rules (glossary: Catalog, Catalog Type, Catalog Item, ADR-0005).
 * A Catalog Type is Organization data — a name, the Billing Units its items
 * may use, a colour and an active switch — so no rule here branches on a
 * particular type: Product and Add-on are only the defaults every
 * Organization starts with.
 */
import type { BillingUnit } from "../enums"
import { BILLING_UNITS } from "../enums"

/**
 * How many colours a Catalog Type can take: the categorical series after
 * labour (slot 1), in the validated order. `colourIndex` 0 is series 2.
 */
export const CATALOG_TYPE_COLOUR_COUNT = 6

/** At most this many active Catalog Types, so each keeps a distinct colour. */
export const MAX_ACTIVE_CATALOG_TYPES = CATALOG_TYPE_COLOUR_COUNT

/** The longest Catalog Type name (singular or plural). */
export const CATALOG_TYPE_NAME_MAX = 40

/** A Catalog Type's facts the rules read. */
export interface CatalogTypeRules {
  singular: string
  plural: string
  billingUnits: readonly BillingUnit[]
}

export interface DefaultCatalogType extends CatalogTypeRules {
  colourIndex: number
}

/**
 * The Catalog Types a new Organization starts with, in order. Ordinary
 * types: the Organization may rename, deactivate or delete them.
 */
export const DEFAULT_CATALOG_TYPES: readonly DefaultCatalogType[] = [
  {
    singular: "Product",
    plural: "Products",
    billingUnits: ["each"],
    colourIndex: 0,
  },
  {
    singular: "Add-on",
    plural: "Add-ons",
    billingUnits: ["each", "hour"],
    colourIndex: 1,
  },
]

const UNIT_NAMES: Record<BillingUnit, string> = { each: "Each", hour: "Hour" }

/** "Each", "Each or Hour" — a type's Billing Units for UI copy. */
export function billingUnitsLabel(units: readonly BillingUnit[]): string {
  return BILLING_UNITS.filter((u) => units.includes(u))
    .map((u) => UNIT_NAMES[u])
    .join(" or ")
}

export type CatalogItemBillingUnitCheck =
  | { ok: true }
  | { ok: false; reason: "billing_unit_not_allowed"; message: string }

/** Whether a Catalog Item of `type` may be billed by `unit`. */
export function checkCatalogItemBillingUnit(
  type: CatalogTypeRules,
  unit: BillingUnit
): CatalogItemBillingUnitCheck {
  if (type.billingUnits.includes(unit)) return { ok: true }
  return {
    ok: false,
    reason: "billing_unit_not_allowed",
    message: `${type.plural} are billed ${billingUnitsLabel(type.billingUnits)}, not ${UNIT_NAMES[unit]}.`,
  }
}

/** The Billing Unit a new item of `type` starts with (Each when allowed). */
export function defaultBillingUnit(type: CatalogTypeRules): BillingUnit {
  return type.billingUnits.includes("each")
    ? "each"
    : (type.billingUnits[0] ?? "each")
}

// ---------------------------------------------------------------------------
// Managing Catalog Types (Settings → Catalog types)
// ---------------------------------------------------------------------------

/** A Catalog Type as a whole, as Settings creates or edits it. */
export interface CatalogTypeDraft extends CatalogTypeRules {
  colourIndex: number
  active: boolean
}

/** Another Catalog Type of the Organization, as the checks read it. */
export interface OtherCatalogType {
  singular: string
  plural: string
  colourIndex: number
  active: boolean
}

export type CatalogTypeIssueReason =
  | "blank"
  | "too_long"
  | "duplicate_name"
  | "no_billing_unit"
  | "invalid_colour"
  | "colour_taken"
  | "too_many_active"

export interface CatalogTypeIssue {
  reason: CatalogTypeIssueReason
  field: "singular" | "plural" | "billingUnits" | "colourIndex" | "active"
  message: string
}

export type CatalogTypeCheck =
  | {
      ok: true
      /** The draft normalised: names trimmed, Billing Units in order. */
      type: {
        singular: string
        plural: string
        billingUnits: BillingUnit[]
        colourIndex: number
        active: boolean
      }
    }
  | {
      ok: false
      /** The first issue (the API's refusal). */
      reason: CatalogTypeIssueReason
      message: string
      /** Every issue, one per field at most (the form's errors). */
      issues: CatalogTypeIssue[]
    }

/** Whether two Catalog Type names are the same (trimmed, ignoring case). */
export function sameCatalogTypeName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
}

/**
 * The colour indexes a type may take: those no *other active* type uses
 * (colours are distinct among active types). In index order.
 */
export function freeCatalogTypeColours(
  others: readonly OtherCatalogType[]
): number[] {
  const taken = new Set(
    others.filter((t) => t.active).map((t) => t.colourIndex)
  )
  return Array.from({ length: CATALOG_TYPE_COLOUR_COUNT }, (_, i) => i).filter(
    (i) => !taken.has(i)
  )
}

/**
 * Checks a Catalog Type against the Organization's other types (ADR-0005):
 *
 * - singular and plural names are required, at most `CATALOG_TYPE_NAME_MAX`
 *   characters, and not another type's singular or plural (ignoring case);
 * - at least one Billing Unit;
 * - a colour index in `0 … CATALOG_TYPE_COLOUR_COUNT - 1`, and while active
 *   one no other active type uses;
 * - at most `MAX_ACTIVE_CATALOG_TYPES` active types.
 *
 * The API runs it on create and on the merged result of an update; the form
 * runs it on every submit, so both refuse the same things.
 */
export function checkCatalogType(
  draft: CatalogTypeDraft,
  others: readonly OtherCatalogType[]
): CatalogTypeCheck {
  const issues: CatalogTypeIssue[] = []
  const names = { singular: draft.singular.trim(), plural: draft.plural.trim() }
  const otherNames = others.flatMap((t) => [t.singular, t.plural])

  for (const field of ["singular", "plural"] as const) {
    const name = names[field]
    const what = field === "singular" ? "a singular name" : "a plural name"
    if (!name) {
      issues.push({ reason: "blank", field, message: `Enter ${what}.` })
    } else if (name.length > CATALOG_TYPE_NAME_MAX) {
      issues.push({
        reason: "too_long",
        field,
        message: `Use at most ${CATALOG_TYPE_NAME_MAX} characters.`,
      })
    } else if (otherNames.some((other) => sameCatalogTypeName(other, name))) {
      issues.push({
        reason: "duplicate_name",
        field,
        message: `A Catalog Type named “${name}” already exists.`,
      })
    }
  }

  const billingUnits = BILLING_UNITS.filter((u) =>
    draft.billingUnits.includes(u)
  )
  if (billingUnits.length === 0) {
    issues.push({
      reason: "no_billing_unit",
      field: "billingUnits",
      message: "Pick at least one Billing Unit.",
    })
  }

  const overCap =
    draft.active &&
    others.filter((t) => t.active).length >= MAX_ACTIVE_CATALOG_TYPES
  if (overCap) {
    issues.push({
      reason: "too_many_active",
      field: "active",
      message: `At most ${MAX_ACTIVE_CATALOG_TYPES} Catalog Types can be active. Deactivate one first.`,
    })
  }

  const colourInRange =
    Number.isInteger(draft.colourIndex) &&
    draft.colourIndex >= 0 &&
    draft.colourIndex < CATALOG_TYPE_COLOUR_COUNT
  if (!colourInRange) {
    issues.push({
      reason: "invalid_colour",
      field: "colourIndex",
      message: "Pick one of the colours.",
    })
  } else if (draft.active && !overCap) {
    // With every colour in use, the cap is the refusal that explains it.
    const holder = others.find(
      (t) => t.active && t.colourIndex === draft.colourIndex
    )
    if (holder) {
      issues.push({
        reason: "colour_taken",
        field: "colourIndex",
        message: `${holder.plural} already use this colour. Pick another.`,
      })
    }
  }

  const [first] = issues
  if (first) {
    return { ok: false, reason: first.reason, message: first.message, issues }
  }
  return {
    ok: true,
    type: {
      singular: names.singular,
      plural: names.plural,
      billingUnits,
      colourIndex: draft.colourIndex,
      active: draft.active,
    },
  }
}

export type BillingUnitRemovalCheck =
  | { ok: true }
  | { ok: false; reason: "billing_unit_in_use"; message: string }

/**
 * Whether a type may go from `from` to `to` Billing Units: a unit can only
 * be removed while none of the type's Catalog Items (active or not) is
 * billed by it. `itemsByUnit` counts the type's items per Billing Unit.
 */
export function checkBillingUnitRemoval(input: {
  type: Pick<CatalogTypeRules, "singular" | "plural">
  from: readonly BillingUnit[]
  to: readonly BillingUnit[]
  itemsByUnit: Partial<Record<BillingUnit, number>>
}): BillingUnitRemovalCheck {
  for (const unit of BILLING_UNITS) {
    if (!input.from.includes(unit) || input.to.includes(unit)) continue
    const count = input.itemsByUnit[unit] ?? 0
    if (count === 0) continue
    const items = count === 1 ? input.type.singular : input.type.plural
    return {
      ok: false,
      reason: "billing_unit_in_use",
      message: `${count} ${items} ${count === 1 ? "is" : "are"} billed ${UNIT_NAMES[unit]}. Change ${count === 1 ? "its" : "their"} Billing Unit before removing ${UNIT_NAMES[unit]}.`,
    }
  }
  return { ok: true }
}
