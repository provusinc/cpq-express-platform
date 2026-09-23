import type { BillingUnit } from "@workspace/domain/enums"

// Catalog Item kind names come from the Organization's Label Overrides:
// `useLabels()[kind]` (components/shell/labels.tsx).

export const BILLING_UNIT_LABELS: Record<BillingUnit, string> = {
  each: "Each",
  hour: "Hour",
}

/** The status tabs of a catalog list ("all" is the default). */
export const ACTIVE_VIEWS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const
export type ActiveView = (typeof ACTIVE_VIEWS)[number]["value"]

/** The tabs with their counts (`statusCounts` from a catalog list). */
export const activeViews = (counts?: Record<ActiveView, number>) =>
  ACTIVE_VIEWS.map((view) => ({
    ...view,
    count: counts?.[view.value],
    dot:
      view.value === "active"
        ? "bg-success"
        : view.value === "inactive"
          ? "bg-neutral"
          : undefined,
  }))
