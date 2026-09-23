/**
 * Reading an Organization's settings from any command. Settings rows are
 * created on the first save, so these fall back to the defaults (Hours Per
 * Day 8, deletable Draft and Rejected, canonical labels) until then.
 *
 *   const { hoursPerDay, deletableStatuses } = await getOrganizationSettings(ctx.scope)
 *   defaultLineItemQuantity({ billingUnit, timePeriod, hoursPerDay })
 *   can(ctx.actor, "quote.delete", quote, { deletableStatuses })
 */
import { eq, schema } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import {
  DEFAULT_DOCUMENT_SETTINGS,
  sectionsFromColumns,
} from "@workspace/domain/documents"
import type { DocumentSettings } from "@workspace/domain/documents"
import type { QuoteStatus } from "@workspace/domain/enums"
import { DEFAULT_DELETABLE_STATUSES } from "@workspace/domain/policy"
import {
  DEFAULT_HOURS_PER_DAY_VALUE,
  resolveLabels,
} from "@workspace/domain/settings"
import type { Labels } from "@workspace/domain/settings"
import type { ObjectStorage } from "@workspace/storage"

const {
  documentSettings,
  labelOverrides,
  organizationSettings,
  organizations,
} = schema

export interface OrganizationSettings {
  /** Glossary: Hours Per Day, at storage scale (e.g. "8.00"). */
  hoursPerDay: string
  /** Statuses in which Quotes may be deleted (never a committed status). */
  deletableStatuses: QuoteStatus[]
}

/** Hours Per Day and the deletable statuses (the domain's `PolicySettings`). */
export async function getOrganizationSettings(
  scope: OrganizationScope
): Promise<OrganizationSettings> {
  const [row] = await scope.findMany(organizationSettings, { limit: 1 })
  return {
    hoursPerDay: row?.hoursPerDay ?? DEFAULT_HOURS_PER_DAY_VALUE,
    deletableStatuses: row?.deletableStatuses ?? [
      ...DEFAULT_DELETABLE_STATUSES,
    ],
  }
}

/** Every term's display names (Label Overrides over the canonical names). */
export async function getLabels(scope: OrganizationScope): Promise<Labels> {
  const rows = await scope.findMany(labelOverrides)
  return resolveLabels(rows)
}

/** How long a logo URL handed to the browser stays valid: 1 hour. */
export const LOGO_URL_EXPIRES_IN_SECONDS = 60 * 60

/**
 * Company information (Settings → Company) with a short-lived URL for the
 * logo, or `logoUrl: null` without one.
 */
export async function getCompany(
  scope: OrganizationScope,
  storage: ObjectStorage
) {
  const [company] = await scope.db
    .select({
      name: organizations.name,
      email: organizations.email,
      phone: organizations.phone,
      website: organizations.website,
      addressLine1: organizations.addressLine1,
      addressLine2: organizations.addressLine2,
      city: organizations.city,
      region: organizations.region,
      postalCode: organizations.postalCode,
      country: organizations.country,
      logoKey: organizations.logoKey,
    })
    .from(organizations)
    .where(eq(organizations.id, scope.organizationId))
    .limit(1)
  const { logoKey, ...info } = company!
  return {
    ...info,
    logoUrl: logoKey
      ? await storage.presignGet(logoKey, {
          expiresIn: LOGO_URL_EXPIRES_IN_SECONDS,
        })
      : null,
  }
}

/**
 * The Organization's document settings (Settings → Documents): format,
 * colours, sections in order with their visibility, decimals, locale,
 * footer and terms. `DEFAULT_DOCUMENT_SETTINGS` until an Admin saves them.
 */
export async function getDocumentSettings(
  scope: OrganizationScope
): Promise<DocumentSettings> {
  const [row] = await scope.findMany(documentSettings, { limit: 1 })
  if (!row) {
    return {
      ...DEFAULT_DOCUMENT_SETTINGS,
      sections: DEFAULT_DOCUMENT_SETTINGS.sections.map((s) => ({ ...s })),
    }
  }
  return {
    format: row.format,
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    sections: sectionsFromColumns(row.sectionOrder, row.hiddenSections),
    moneyDecimals: row.moneyDecimals,
    quantityDecimals: row.quantityDecimals,
    locale: row.locale,
    footerText: row.footerText,
    terms: row.terms,
  }
}
