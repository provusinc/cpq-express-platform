/** zod building blocks shared by router inputs. */
import { z } from "zod"

import { ROLES } from "@workspace/domain/enums"
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
