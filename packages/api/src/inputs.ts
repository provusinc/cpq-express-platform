/** zod building blocks shared by router inputs, plus small query helpers. */
import { z } from "zod"

import { isIsoDate } from "@workspace/domain/dates"
import { ROLES } from "@workspace/domain/enums"
import { Decimal, toMoneyString } from "@workspace/domain/money"
import { checkSlug, isCurrencyCode } from "@workspace/domain/organizations"

/** An email address, trimmed and lowercased (how Invitations store it). */
export const emailInput = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address."))

export const roleInput = z.enum(ROLES)

/** A new Organization's slug: format and reserved list (uniqueness is checked in the command). */
export const slugInput = z
  .string()
  .trim()
  .superRefine((slug, ctx) => {
    const check = checkSlug(slug)
    if (!check.ok) ctx.addIssue({ code: "custom", message: check.message })
  })

/** An ISO 4217 currency code, e.g. "USD". */
export const currencyInput = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isCurrencyCode, "Use a three-letter ISO 4217 currency code.")

/** A calendar date as an ISO `yyyy-MM-dd` string (`IsoDate`), never a `Date`. */
export const isoDateInput = z
  .string()
  .trim()
  .refine(isIsoDate, "Enter a date as yyyy-MM-dd.")

/** Required text: trimmed, non-empty. */
export const requiredText = (max = 200) => z.string().trim().min(1).max(max)

/**
 * Optional text: trimmed; blank becomes `null` (clears the field). In an
 * update, leaving the key out (`undefined`) keeps the stored value.
 */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : v === undefined ? undefined : null))

/** Optional email: trimmed, validated; blank becomes `null`. */
export const optionalEmail = z
  .union([z.literal(""), z.email().max(320)])
  .nullish()
  .transform((v) => (v ? v : v === undefined ? undefined : null))

/**
 * A non-negative money amount (ADR-0002): a decimal string (or number) with
 * at most 15 integer digits and 4 decimals, normalised to storage scale
 * ("1234.5" → "1234.5000"). Never parsed into a float.
 */
export const money = z
  .union([z.string().trim(), z.number()])
  .refine(isMoney, {
    message: "Enter an amount of 0 or more with up to 4 decimals.",
  })
  .transform((v) => toMoneyString(v))

const MONEY_PATTERN = /^\d{1,15}(\.\d{1,4})?$/

export function isMoney(value: string | number) {
  if (typeof value === "number") {
    return (
      Number.isFinite(value) && MONEY_PATTERN.test(new Decimal(value).toFixed())
    )
  }
  return MONEY_PATTERN.test(value)
}

/** Page through a list: 1-based `page`, `pageSize` up to 100. */
export const paging = {
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
}

/** A search term for ILIKE: trimmed, with `%`, `_` and `\` escaped. */
export function containsPattern(term: string) {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** Active/inactive filter for catalog lists ("all" shows both). */
export const activeFilter = z.enum(["active", "inactive", "all"]).default("all")

/** Drops keys whose value is `undefined` (an update leaves them unchanged). */
export function stripUndefined<T extends Record<string, unknown>>(values: T) {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined)
  ) as { [K in keyof T]: Exclude<T[K], undefined> }
}
