/**
 * CSV import rules for the catalog (#11). The browser parses the file and
 * sends its rows as `{ header: value }` records; these functions turn each
 * row into insert values or a list of per-column errors. Pure, so the
 * validate (preview) and import commands apply exactly the same rules.
 *
 * Templates (headers are matched ignoring case, spaces and punctuation):
 * - Products / Add-ons: Name, Type, Description, Price, Cost, Billing Unit,
 *   Tags, Is Active
 * - Resource Roles: Name, Description, Bill Rate, Cost Rate,
 *   Location Country, Location State, Location City, Is Active
 */
import { z } from "zod"

import type { CatalogItemKind } from "@workspace/domain/enums"
import { toMoneyString } from "@workspace/domain/money"

import { isMoney } from "./inputs"

/** Most rows one import may carry. */
export const IMPORT_ROW_LIMIT = 5000

/** Rows as sent by the browser: one record of header → cell per data row. */
export const importRowsInput = z
  .array(z.record(z.string(), z.string().max(5000)))
  .min(1, "The file has no data rows.")
  .max(IMPORT_ROW_LIMIT, `Import at most ${IMPORT_ROW_LIMIT} rows at a time.`)

export interface CellError {
  /** The template column the error is about. */
  column: string
  message: string
}

export interface RowResult<T> {
  /** 1-based data row number (the header is row 0; line = row + 1). */
  row: number
  /** The values to insert, when the row is valid. */
  values: T | null
  errors: CellError[]
}

export interface CatalogItemImportValues {
  kind: CatalogItemKind
  name: string
  description: string | null
  price: string
  cost: string
  billingUnit: "each" | "hour"
  tags: string[]
  active: boolean
}

export interface ResourceRoleImportValues {
  name: string
  description: string | null
  billRate: string
  costRate: string
  locationCountry: string | null
  locationState: string | null
  locationCity: string | null
  active: boolean
}

const headerKey = (header: string) =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "")

/** Looks up cells by any of their accepted header spellings. */
function cells(row: Record<string, string>) {
  const byKey = new Map<string, string>()
  for (const [header, value] of Object.entries(row)) {
    byKey.set(headerKey(header), value.trim())
  }
  return (...aliases: string[]) => {
    for (const alias of aliases) {
      const value = byKey.get(headerKey(alias))
      if (value !== undefined) return value
    }
    return ""
  }
}

/** "$1,250.5" → "1250.5000"; null (with an error) when not a valid amount. */
function parseMoney(
  raw: string,
  column: string,
  errors: CellError[]
): string | null {
  if (raw === "") {
    errors.push({ column, message: `${column} is required.` })
    return null
  }
  const cleaned = raw.replace(/^\$/, "").replace(/,(?=\d{3}(\D|$))/g, "")
  if (!isMoney(cleaned)) {
    errors.push({
      column,
      message: `${column} must be an amount of 0 or more with up to 4 decimals (got “${raw}”).`,
    })
    return null
  }
  return toMoneyString(cleaned)
}

const TRUE = new Set(["true", "yes", "y", "1", "active"])
const FALSE = new Set(["false", "no", "n", "0", "inactive"])

function parseActive(raw: string, errors: CellError[]) {
  const value = raw.toLowerCase()
  if (value === "" || TRUE.has(value)) return true
  if (FALSE.has(value)) return false
  errors.push({
    column: "Is Active",
    message: `Is Active must be true or false (got “${raw}”).`,
  })
  return true
}

function parseName(raw: string, errors: CellError[]) {
  if (raw === "") errors.push({ column: "Name", message: "Name is required." })
  else if (raw.length > 200) {
    errors.push({
      column: "Name",
      message: "Name is longer than 200 characters.",
    })
  }
  return raw
}

const optional = (raw: string) => (raw === "" ? null : raw)

function parseKind(
  raw: string,
  defaultKind: CatalogItemKind | undefined,
  errors: CellError[]
): CatalogItemKind | null {
  const key = headerKey(raw)
  if (key === "" && defaultKind) return defaultKind
  if (key === "product") return "product"
  if (key === "addon") return "add_on"
  errors.push({
    column: "Type",
    message:
      raw === ""
        ? "Type is required (Product or Add-on)."
        : `Type must be Product or Add-on (got “${raw}”).`,
  })
  return null
}

function parseBillingUnit(raw: string, errors: CellError[]) {
  const value = raw.toLowerCase()
  if (value === "" || value === "each") return "each" as const
  if (value === "hour" || value === "hours" || value === "hourly") {
    return "hour" as const
  }
  errors.push({
    column: "Billing Unit",
    message: `Billing Unit must be Each or Hour (got “${raw}”).`,
  })
  return null
}

/** Tags are separated by semicolons (or "|"), trimmed and lower-cased. */
function parseTags(raw: string) {
  return [
    ...new Set(
      raw
        .split(/[;|]/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    ),
  ].slice(0, 30)
}

/**
 * One Products/Add-ons row. `defaultKind` fills a blank Type (the page the
 * import was started from).
 */
export function parseCatalogItemRow(
  row: Record<string, string>,
  index: number,
  defaultKind?: CatalogItemKind
): RowResult<CatalogItemImportValues> {
  const get = cells(row)
  const errors: CellError[] = []
  const name = parseName(get("Name"), errors)
  const kind = parseKind(get("Type", "Kind"), defaultKind, errors)
  const price = parseMoney(get("Price", "List Price"), "Price", errors)
  const cost = parseMoney(get("Cost"), "Cost", errors)
  const billingUnit = parseBillingUnit(get("Billing Unit", "Unit"), errors)
  if (kind === "product" && billingUnit === "hour") {
    errors.push({
      column: "Billing Unit",
      message:
        "A Product is always billed Each; only Add-ons can be billed by the Hour.",
    })
  }
  const active = parseActive(get("Is Active", "Active"), errors)
  const description = optional(get("Description"))
  return {
    row: index + 1,
    errors,
    values:
      errors.length === 0
        ? {
            kind: kind!,
            name,
            description,
            price: price!,
            cost: cost!,
            billingUnit: billingUnit!,
            tags: parseTags(get("Tags")),
            active,
          }
        : null,
  }
}

/** One Resource Roles row. A Billing Unit column, if present, must be Hour. */
export function parseResourceRoleRow(
  row: Record<string, string>,
  index: number
): RowResult<ResourceRoleImportValues> {
  const get = cells(row)
  const errors: CellError[] = []
  const name = parseName(get("Name"), errors)
  const billRate = parseMoney(
    get("Bill Rate", "Price", "Rate"),
    "Bill Rate",
    errors
  )
  const costRate = parseMoney(get("Cost Rate", "Cost"), "Cost Rate", errors)
  const unit = get("Billing Unit").toLowerCase()
  if (unit !== "" && !["hour", "hours", "hourly"].includes(unit)) {
    errors.push({
      column: "Billing Unit",
      message: "Resource Roles are always billed by the Hour.",
    })
  }
  const active = parseActive(get("Is Active", "Active"), errors)
  return {
    row: index + 1,
    errors,
    values:
      errors.length === 0
        ? {
            name,
            description: optional(get("Description")),
            billRate: billRate!,
            costRate: costRate!,
            locationCountry: optional(get("Location Country", "Country")),
            locationState: optional(get("Location State", "State")),
            locationCity: optional(get("Location City", "City")),
            active,
          }
        : null,
  }
}

/** Summary returned by the validate commands (the import preview). */
export function summarize<T>(results: RowResult<T>[]) {
  const errorCount = results.filter((r) => r.errors.length > 0).length
  return {
    rows: results,
    validCount: results.length - errorCount,
    errorCount,
  }
}
