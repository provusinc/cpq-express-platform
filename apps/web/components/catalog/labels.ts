import type { BillingUnit, CatalogItemKind } from "@workspace/domain/enums"

/**
 * Display names for Catalog Item kinds. Label Overrides (Settings) will
 * replace these per Organization later.
 */
export const KIND_LABELS: Record<
  CatalogItemKind,
  { singular: string; plural: string }
> = {
  product: { singular: "Product", plural: "Products" },
  add_on: { singular: "Add-on", plural: "Add-ons" },
}

export const BILLING_UNIT_LABELS: Record<BillingUnit, string> = {
  each: "Each",
  hour: "Hour",
}

/** Options for an active/inactive list filter ("all" is the default). */
export const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const
