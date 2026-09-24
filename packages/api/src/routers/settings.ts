import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { eq, schema, sql, uuidv7 } from "@workspace/db"
import type { Db } from "@workspace/db"
import {
  checkDocumentSettings,
  DOCUMENT_FORMATS,
  DOCUMENT_SECTIONS,
  sectionsToColumns,
} from "@workspace/domain/documents"
import { LABEL_TERMS, QUOTE_STATUSES } from "@workspace/domain/enums"
import { checkDeletableStatuses } from "@workspace/domain/policy"
import {
  checkHoursPerDay,
  checkLabelOverride,
  checkLogoFile,
} from "@workspace/domain/settings"
import {
  isOrganizationObjectKey,
  organizationObjectKey,
} from "@workspace/storage"
import type { ObjectStorage } from "@workspace/storage"

import {
  getCompany,
  getDocumentSettings,
  getLabels,
  getOrganizationSettings,
} from "../settings"
import {
  createTRPCRouter,
  organizationProcedure,
  permittedProcedure,
} from "../trpc"

const {
  documentSettings,
  labelOverrides,
  organizationSettings,
  organizations,
} = schema

/** Object-key area of Organization logos: `organizations/<id>/logo/<name>`. */
const LOGO_AREA = "logo"

const TEXT_MAX = 200

/** Optional free text: trimmed, blank → null. */
const optionalText = (max = TEXT_MAX) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters.`)
    .transform((value) => value || null)
    .nullish()
    .transform((value) => value ?? null)

/** An optional website; a bare domain gets `https://`. */
const websiteInput = optionalText().pipe(
  z
    .string()
    .transform((value) =>
      /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`
    )
    .pipe(
      z.url({ protocol: /^https?$/, error: "Enter a valid website address." })
    )
    .nullable()
)

const emailOrBlank = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.union([z.literal(""), z.email("Enter a valid email address.")]))
  .nullish()
  .transform((value) => value || null)

const companyInput = z.object({
  /** The Organization's name, shown across the app and on Quote Documents. */
  name: z
    .string()
    .trim()
    .min(1, "Enter the company name.")
    .max(TEXT_MAX, `Use at most ${TEXT_MAX} characters.`),
  email: emailOrBlank,
  phone: optionalText(40),
  website: websiteInput,
  addressLine1: optionalText(),
  addressLine2: optionalText(),
  city: optionalText(),
  region: optionalText(),
  postalCode: optionalText(20),
  country: optionalText(),
})

const hoursPerDayInput = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    const check = checkHoursPerDay(value)
    if (!check.ok) {
      ctx.addIssue({ code: "custom", message: check.message })
      return z.NEVER
    }
    return check.value
  })

const deletableStatusesInput = z
  .array(z.enum(QUOTE_STATUSES))
  .transform((statuses, ctx) => {
    const { accepted, refused } = checkDeletableStatuses(statuses)
    if (refused.length > 0) {
      ctx.addIssue({
        code: "custom",
        message:
          "Quotes in a committed status (Pending Approval, Approved, Pending Customer Approval, Customer Approved) can never be deleted.",
      })
      return z.NEVER
    }
    return accepted
  })

const labelOverrideInput = z
  .object({
    term: z.enum(LABEL_TERMS),
    singular: z.string().nullish(),
    plural: z.string().nullish(),
    enabled: z.boolean().default(true),
  })
  .transform((override, ctx) => {
    const check = checkLabelOverride(override)
    if (!check.ok) {
      ctx.addIssue({
        code: "custom",
        message: check.message,
        path: [check.field],
      })
      return z.NEVER
    }
    return check.value
  })

const labelsInput = z.object({
  overrides: z
    .array(labelOverrideInput)
    .max(LABEL_TERMS.length)
    .refine(
      (overrides) =>
        new Set(overrides.map((o) => o.term)).size === overrides.length,
      "Give each term at most once."
    ),
})

/** Settings → Documents; validated and normalised by the domain's rules. */
const documentSettingsInput = z
  .object({
    format: z.enum(DOCUMENT_FORMATS),
    primaryColor: z.string(),
    accentColor: z.string(),
    sections: z
      .array(
        z.object({ section: z.enum(DOCUMENT_SECTIONS), visible: z.boolean() })
      )
      .max(DOCUMENT_SECTIONS.length * 2),
    moneyDecimals: z.number().int().nullable(),
    quantityDecimals: z.number().int(),
    locale: z.string().max(35),
    footerText: z.string().nullish(),
    terms: z.string().nullish(),
  })
  .transform((input, ctx) => {
    const check = checkDocumentSettings(input)
    if (!check.ok) {
      ctx.addIssue({
        code: "custom",
        message: check.message,
        path: [check.field],
      })
      return z.NEVER
    }
    return check.value
  })

const manageSettings = permittedProcedure("settings.manage")

export const settingsRouter = createTRPCRouter({
  /**
   * Every term's display names and visibility (Label Overrides over the
   * canonical names). Any member: the whole UI is labelled with these.
   */
  labels: organizationProcedure.query(({ ctx }) => getLabels(ctx.scope)),

  /**
   * Hours Per Day and the deletable Quote Statuses. Any member: pricing and
   * Quote deletion read them.
   */
  quoting: organizationProcedure.query(({ ctx }) =>
    getOrganizationSettings(ctx.scope)
  ),

  /**
   * Company information and a short-lived logo URL. Any member: Quote
   * Documents print it.
   */
  company: organizationProcedure.query(({ ctx }) =>
    getCompany(ctx.scope, ctx.storage)
  ),

  /**
   * Document settings: how Quote Documents look (format, colours, section
   * order and visibility, decimals, locale, footer, terms). Any member: the
   * live preview renders with them.
   */
  documents: organizationProcedure.query(({ ctx }) =>
    getDocumentSettings(ctx.scope)
  ),

  /** Replaces the document settings. */
  updateDocuments: manageSettings
    .input(documentSettingsInput)
    .mutation(async ({ ctx, input }) => {
      const { sections, ...rest } = input
      const values = { ...rest, ...sectionsToColumns(sections) }
      await ctx.db
        .insert(documentSettings)
        .values({ organizationId: ctx.organization.id, ...values })
        .onConflictDoUpdate({
          target: documentSettings.organizationId,
          set: { ...values, updatedAt: new Date() },
        })
      return getDocumentSettings(ctx.scope)
    }),

  /** Replaces the company information (name, contact details, address). */
  updateCompany: manageSettings
    .input(companyInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(organizations)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(organizations.id, ctx.organization.id))
      return getCompany(ctx.scope, ctx.storage)
    }),

  /** Sets Hours Per Day and the deletable Quote Statuses. */
  updateQuoting: manageSettings
    .input(
      z.object({
        hoursPerDay: hoursPerDayInput,
        deletableStatuses: deletableStatusesInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(organizationSettings)
        .values({ organizationId: ctx.organization.id, ...input })
        .onConflictDoUpdate({
          target: organizationSettings.organizationId,
          set: { ...input, updatedAt: new Date() },
        })
      return getOrganizationSettings(ctx.scope)
    }),

  /**
   * Saves Label Overrides for the given terms (others are left as they are).
   * Blank names mean the canonical name; only Products and Add-ons can be
   * hidden.
   */
  updateLabels: manageSettings
    .input(labelsInput)
    .mutation(async ({ ctx, input }) => {
      if (input.overrides.length > 0) {
        await ctx.db
          .insert(labelOverrides)
          .values(
            input.overrides.map((override) => ({
              organizationId: ctx.organization.id,
              ...override,
            }))
          )
          .onConflictDoUpdate({
            target: [labelOverrides.organizationId, labelOverrides.term],
            set: {
              singular: sql`excluded.singular`,
              plural: sql`excluded.plural`,
              enabled: sql`excluded.enabled`,
              updatedAt: new Date(),
            },
          })
      }
      return getLabels(ctx.scope)
    }),

  /**
   * Step 1 of a logo upload: a presigned PUT URL for one file of this type
   * and exact size. The browser uploads straight to object storage, then
   * calls `confirmLogoUpload` with the key.
   */
  requestLogoUpload: manageSettings
    .input(
      z.object({
        contentType: z.string().min(1),
        size: z.number().int(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const check = checkLogoFile(input)
      if (!check.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: check.message })
      }
      const key = organizationObjectKey(
        ctx.organization.id,
        LOGO_AREA,
        `${uuidv7()}.${check.extension}`
      )
      const upload = await ctx.storage.presignPut(key, {
        contentType: check.contentType,
        size: input.size,
      })
      return { key, ...upload }
    }),

  /**
   * Step 2: makes the uploaded object the logo, after checking it is this
   * Organization's upload and still a valid logo. The previous logo's object
   * is deleted.
   */
  confirmLogoUpload: manageSettings
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!isOrganizationObjectKey(input.key, ctx.organization.id, LOGO_AREA)) {
        // Like a record id from another Organization: nothing to find here.
        throw new TRPCError({ code: "NOT_FOUND", message: "Upload not found." })
      }
      const object = await ctx.storage.head(input.key)
      if (!object) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The upload didn't finish. Try again.",
        })
      }
      const check = checkLogoFile(object)
      if (!check.ok) {
        await ctx.storage.delete(input.key)
        throw new TRPCError({ code: "BAD_REQUEST", message: check.message })
      }
      const previous = await replaceLogoKey(ctx, input.key)
      if (previous && previous !== input.key) {
        await deleteQuietly(ctx.storage, previous)
      }
      return getCompany(ctx.scope, ctx.storage)
    }),

  /** Removes the logo (and its object). */
  removeLogo: manageSettings.mutation(async ({ ctx }) => {
    const previous = await replaceLogoKey(ctx, null)
    if (previous) await deleteQuietly(ctx.storage, previous)
    return getCompany(ctx.scope, ctx.storage)
  }),
})

/** Sets the logo key under a row lock and returns the one it replaced. */
function replaceLogoKey(
  ctx: {
    db: Db
    organization: { id: string }
  },
  key: string | null
) {
  return ctx.db.transaction(async (tx) => {
    const [current] = await tx
      .select({ logoKey: organizations.logoKey })
      .from(organizations)
      .where(eq(organizations.id, ctx.organization.id))
      .for("update")
    await tx
      .update(organizations)
      .set({ logoKey: key, updatedAt: new Date() })
      .where(eq(organizations.id, ctx.organization.id))
    return current?.logoKey ?? null
  })
}

/** Deletes an object that is no longer referenced; a failure only leaves an orphan. */
async function deleteQuietly(storage: ObjectStorage, key: string) {
  try {
    await storage.delete(key)
  } catch (error) {
    console.warn(`Could not delete ${key} from object storage`, error)
  }
}
