import type { BillingUnit } from "@workspace/domain/enums"

// Catalog Item kind names come from the Organization's Label Overrides:
// `useLabels()[kind]` (components/shell/labels.tsx).

export const BILLING_UNIT_LABELS: Record<BillingUnit, string> = {
  each: "Each",
  hour: "Hour",
}

/** Options for an active/inactive list filter ("all" is the default). */
export const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const
