import { toCsv } from "@/lib/csv"

/**
 * Downloadable CSV templates. The headers match the API's import rules
 * (`packages/api/src/catalog-import.ts`), which also accept the old
 * portal's spellings.
 */
export const CATALOG_ITEM_TEMPLATE = {
  fileName: "catalog-items-template.csv",
  csv: toCsv([
    [
      "Name",
      "Type",
      "Description",
      "Price",
      "Cost",
      "Billing Unit",
      "Tags",
      "Is Active",
    ],
    [
      "Premium Support Plan",
      "Product",
      "24/7 dedicated support and SLA management",
      "250.00",
      "180.00",
      "Each",
      "support;premium",
      "TRUE",
    ],
    [
      "Project Management",
      "Add-on",
      "Project management services",
      "125.00",
      "100.00",
      "Hour",
      "management;project",
      "TRUE",
    ],
  ]),
  help: "Type is Product or Add-on. Billing Unit is Each or Hour (Products are always Each). Separate tags with semicolons. Is Active is TRUE or FALSE.",
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
