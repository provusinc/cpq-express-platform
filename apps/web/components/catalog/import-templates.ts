import {
  billingUnitsLabel,
  defaultBillingUnit,
} from "@workspace/domain/catalog"
import { BILLING_UNITS } from "@workspace/domain/enums"
import type { BillingUnit } from "@workspace/domain/enums"

import { toCsv } from "@/lib/csv"

/**
 * Downloadable CSV templates. The headers match the API's import rules
 * (`packages/api/src/catalog-import.ts`), which also accept the old
 * portal's spellings.
 */

/**
 * A Catalog Type's template: every row becomes an item of that type (the
 * page's), so there is no Type column; its example rows use the type's
 * Billing Units.
 */
export function catalogItemTemplate(type: {
  singular: string
  plural: string
  billingUnits: readonly BillingUnit[]
}) {
  const units = BILLING_UNITS.filter((u) => type.billingUnits.includes(u))
  const unitName = (u: BillingUnit) => (u === "hour" ? "Hour" : "Each")
  const slug = type.plural.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  return {
    fileName: `${slug.replace(/^-|-$/g, "") || "catalog-items"}-template.csv`,
    csv: toCsv([
      [
        "Name",
        "Description",
        "Price",
        "Cost",
        "Billing Unit",
        "Tags",
        "Is Active",
      ],
      ...units.map((unit, i) => [
        i === 0 ? "Premium Support Plan" : "Project Management",
        i === 0
          ? "24/7 dedicated support and SLA management"
          : "Project management services",
        i === 0 ? "250.00" : "125.00",
        i === 0 ? "180.00" : "100.00",
        unitName(unit),
        i === 0 ? "support;premium" : "management;project",
        "TRUE",
      ]),
    ]),
    help: `Every row becomes a ${type.singular}. Billing Unit is ${billingUnitsLabel(type.billingUnits)} (blank: ${unitName(defaultBillingUnit(type))}). Separate tags with semicolons. Is Active is TRUE or FALSE.`,
  }
}

export const RESOURCE_ROLE_TEMPLATE = {
  fileName: "resource-roles-template.csv",
  csv: toCsv([
    [
      "Name",
      "Description",
      "Bill Rate",
      "Cost Rate",
      "Location Country",
      "Location State",
      "Location City",
      "Is Active",
    ],
    [
      "Solutions Architect",
      "Cloud solutions design and advisory",
      "185.00",
      "150.00",
      "United States",
      "Illinois",
      "Chicago",
      "TRUE",
    ],
  ]),
  help: "Rates are per hour. Location columns are optional. Is Active is TRUE or FALSE.",
}

/** Starts a download of `csv` as `fileName` in the browser. */
export function downloadCsv(fileName: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
