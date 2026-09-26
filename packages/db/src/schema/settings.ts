import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  numeric,
  pgEnum,
  text,
  unique,
} from "drizzle-orm/pg-core"

import { LABEL_TERMS } from "@workspace/domain/enums"
import {
  DEFAULT_DELETABLE_STAGES,
  DELETABLE_STAGE_OPTIONS,
} from "@workspace/domain/policy"
import {
  HIDEABLE_LABEL_TERMS,
  HOURS_PER_DAY_MAX,
} from "@workspace/domain/settings"

import { timestamps } from "../columns"
import { organizationTable } from "../organization-table"
import { quoteStageEnum } from "./enums"

const list = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "))

/**
 * An Organization's settings (glossary: Hours Per Day; the Stages whose
 * Quotes may be deleted), one row per Organization, typed columns only. The row is created
 * on the first save: until then every setting reads as its default (see
 * `getOrganizationSettings` in `@workspace/api`). The Organization profile and the
 * logo key are columns of `organizations`; Label Overrides are
 * `label_overrides`. Document settings (#21) are added here as columns.
 */
export const organizationSettings = organizationTable(
  "organization_settings",
  {
    /** Glossary: Hours Per Day. More than 0, at most 24. */
    hoursPerDay: numeric({ precision: 4, scale: 2 }).notNull().default("8"),
    /** Stages in which Quotes may be deleted: only Draft and Lost. */
    deletableStages: quoteStageEnum()
      .array()
      .notNull()
      .default(sql.raw(`'{${DEFAULT_DELETABLE_STAGES.join(",")}}'`)),
    ...timestamps(),
  },
  (t) => [
    unique("organization_settings_organization_id_key").on(t.organizationId),
    check(
      "organization_settings_hours_per_day_range",
      sql`${t.hoursPerDay} > 0 and ${t.hoursPerDay} <= ${sql.raw(String(HOURS_PER_DAY_MAX))}`
    ),
    check(
      "organization_settings_deletable_stages_allowed",
      sql`${t.deletableStages} <@ array[${list(DELETABLE_STAGE_OPTIONS)}]::quote_stage[]`
    ),
  ]
)

/** Terms that take a Label Override, from `@workspace/domain`. */
export const labelTermEnum = pgEnum("label_term", LABEL_TERMS)

/**
 * An Organization's own display name for a domain term (glossary: Label
 * Override), at most one per term. `null` names mean the canonical name;
 * `enabled = false` hides the term (Products and Add-ons only). Changes UI
 * wording only: code and API keep the canonical terms.
 */
export const labelOverrides = organizationTable(
  "label_overrides",
  {
    term: labelTermEnum().notNull(),
    singular: text(),
    plural: text(),
    enabled: boolean().notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    unique("label_overrides_organization_id_term_key").on(
      t.organizationId,
      t.term
    ),
    check(
      "label_overrides_only_hideable_disabled",
      sql`${t.enabled} or ${t.term} in (${list(HIDEABLE_LABEL_TERMS)})`
    ),
  ]
)

export type OrganizationSettings = typeof organizationSettings.$inferSelect
export type LabelOverrideRow = typeof labelOverrides.$inferSelect
