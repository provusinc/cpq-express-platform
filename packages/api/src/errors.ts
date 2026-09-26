/**
 * Error helpers shared by the routers.
 *
 * - `notFound(thing)` — the uniform NOT_FOUND for a missing (or another
 *   Organization's) record.
 * - `inUseError(details)` — CONFLICT when a delete is blocked because other
 *   records reference the target (Customers, Catalog Items and Resource
 *   Roles used by Quotes; Customer Types and Industries used by Customers). The structured details reach the client as
 *   `error.data.inUse` (see the errorFormatter in `trpc.ts`):
 *
 *     { kind: "in_use", entity: "customer", name: "Initech",
 *       counts: { quotes: 3 }, examples: ["Q3 renewal", "Pilot", …],
 *       suggestion: "archive" }
 *
 * - `isUniqueViolation(error, constraint)` — a Postgres unique violation of
 *   a named constraint or unique index, for turning races into CONFLICT.
 */
import { TRPCError } from "@trpc/server"

/** What can be blocked from deletion by references to it. */
export type InUseEntity =
  | "customer"
  | "catalog_item"
  | "resource_role"
  | "customer_type"
  | "industry"

/** What references it, counted (only non-zero counts need be present). */
export interface InUseCounts {
  quotes?: number
  lineItems?: number
  customers?: number
}

export interface InUseDetails {
  kind: "in_use"
  entity: InUseEntity
  /** The blocked record's name. */
  name: string
  counts: InUseCounts
  /** A few names of referencing records (e.g. Quote names), for the message. */
  examples: string[]
  /**
   * The alternative to offer: archive (Customers), deactivate (catalog) or
   * retire (Customer Types and Industries).
   */
  suggestion: "archive" | "deactivate" | "retire"
}

/** Carried as the TRPCError's `cause`; the errorFormatter exposes `details`. */
export class InUseError extends Error {
  constructor(readonly details: InUseDetails) {
    super(inUseMessage(details))
    this.name = "InUseError"
  }
}

/** How many examples an "in use" error carries. */
export const IN_USE_EXAMPLE_LIMIT = 5

function inUseMessage({ name, counts, examples, suggestion }: InUseDetails) {
  const parts: string[] = []
  if (counts.quotes) parts.push(plural(counts.quotes, "Quote"))
  if (counts.lineItems) parts.push(plural(counts.lineItems, "Line Item"))
  if (counts.customers) parts.push(plural(counts.customers, "Customer"))
  const used = parts.length > 0 ? parts.join(" and ") : "other records"
  const named = examples.length > 0 ? ` (${examples.join(", ")})` : ""
  const instead = {
    archive: "Archive",
    deactivate: "Deactivate",
    retire: "Retire",
  }[suggestion]
  return `“${name}” is used by ${used}${named}. ${instead} it instead.`
}

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

/** CONFLICT: the record can't be deleted while it is referenced. */
export function inUseError(details: Omit<InUseDetails, "kind">) {
  const cause = new InUseError({
    kind: "in_use",
    ...details,
    examples: details.examples.slice(0, IN_USE_EXAMPLE_LIMIT),
  })
  return new TRPCError({ code: "CONFLICT", message: cause.message, cause })
}

/** The structured details of an "in use" error, or null for any other error. */
export function inUseDetails(error: unknown): InUseDetails | null {
  return error instanceof InUseError ? error.details : null
}

/** NOT_FOUND for a record this Organization doesn't have. */
export function notFound(thing: string) {
  return new TRPCError({ code: "NOT_FOUND", message: `${thing} not found.` })
}

/**
 * Whether `error` (or any error in its `cause` chain — Drizzle wraps driver
 * errors) is a Postgres unique violation of `constraint`.
 */
export function isUniqueViolation(error: unknown, constraint: string) {
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: unknown; constraint_name?: unknown }
    if (pg.code === "23505" && pg.constraint_name === constraint) return true
    if (e === (e as { cause?: unknown }).cause) break
  }
  return false
}
