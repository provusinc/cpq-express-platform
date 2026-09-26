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
