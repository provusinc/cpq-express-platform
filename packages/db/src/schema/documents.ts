import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core"

import {
  DEFAULT_DOCUMENT_SETTINGS,
  DOCUMENT_FORMATS,
  DOCUMENT_SECTIONS,
  MONEY_DECIMALS_MAX,
  QUANTITY_DECIMALS_MAX,
} from "@workspace/domain/documents"

import { timestamps } from "../columns"
import { organizationReference, organizationTable } from "../organization-table"
import { users } from "./auth"
import { quotes } from "./quotes"

/** Standard or compact (glossary: Quote Document), from `@workspace/domain`. */
export const documentFormatEnum = pgEnum("document_format", DOCUMENT_FORMATS)
/** The sections of a Quote Document, from `@workspace/domain`. */
export const documentSectionEnum = pgEnum("document_section", DOCUMENT_SECTIONS)

const HEX = "^#[0-9a-f]{6}$"

/**
 * An Organization's document settings (how its Quote Documents look), one
 * row per Organization, typed columns only; created on the first save, so
 * until then every setting reads as `DEFAULT_DOCUMENT_SETTINGS` (see
 * `getDocumentSettings` in `@workspace/api`).
 *
 * - `sectionOrder` lists every section once, in document order;
 *   `hiddenSections` the ones not shown (`sectionsToColumns` /
 *   `sectionsFromColumns` in the domain convert to and from the list the
 *   API speaks).
 * - `moneyDecimals` null means the currency's minor unit.
 */
export const documentSettings = organizationTable(
  "document_settings",
  {
    format: documentFormatEnum().notNull().default("standard"),
    primaryColor: text()
      .notNull()
      .default(DEFAULT_DOCUMENT_SETTINGS.primaryColor),
    accentColor: text()
      .notNull()
      .default(DEFAULT_DOCUMENT_SETTINGS.accentColor),
    sectionOrder: documentSectionEnum()
      .array()
      .notNull()
      .default(sql.raw(`'{${DOCUMENT_SECTIONS.join(",")}}'`)),
    hiddenSections: documentSectionEnum()
      .array()
      .notNull()
      .default(sql`'{}'`),
    moneyDecimals: smallint(),
    quantityDecimals: smallint()
      .notNull()
      .default(DEFAULT_DOCUMENT_SETTINGS.quantityDecimals),
    locale: text().notNull().default(DEFAULT_DOCUMENT_SETTINGS.locale),
    footerText: text(),
    terms: text(),
    ...timestamps(),
  },
  (t) => [
    unique("document_settings_organization_id_key").on(t.organizationId),
    check(
      "document_settings_colors_hex",
      sql`${t.primaryColor} ~ ${sql.raw(`'${HEX}'`)} and ${t.accentColor} ~ ${sql.raw(`'${HEX}'`)}`
    ),
    check(
      "document_settings_money_decimals_range",
      sql`${t.moneyDecimals} is null or ${t.moneyDecimals} between 0 and ${sql.raw(String(MONEY_DECIMALS_MAX))}`
    ),
    check(
      "document_settings_quantity_decimals_range",
      sql`${t.quantityDecimals} between 0 and ${sql.raw(String(QUANTITY_DECIMALS_MAX))}`
    ),
  ]
)

export type DocumentSettingsRow = typeof documentSettings.$inferSelect

/**
 * An immutable rendering (PDF) of a Quote at a point in time (glossary:
 * Quote Document), versioned 1, 2, 3… within its Quote. The file lives in
 * object storage at `storageKey` (`organizations/<id>/quote-documents/…`);
 * Postgres keeps the key, the size and the snapshots it was rendered from.
 *
 * - `version` is assigned by `generateQuoteDocument` under the Quote's row
 *   lock (max + 1); `(quote, version)` is unique as a backstop.
 * - `quoteSnapshot` is the render input (`QuoteDocumentSnapshot` from
 *   `@workspace/documents`) and `settingsSnapshot` the document settings
 *   used. Neither is ever updated.
 * - One `capturedByMarkSent` can never be deleted.
 * - Deleting the Quote cascades here; the objects are removed by the API.
 */
export const quoteDocuments = organizationTable(
  "quote_documents",
  {
    quoteId: uuid().notNull(),
    version: integer().notNull(),
    storageKey: text().notNull(),
    /** Bytes. */
    fileSize: bigint({ mode: "number" }).notNull(),
    quoteSnapshot: jsonb().notNull(),
    settingsSnapshot: jsonb().notNull(),
    notes: text(),
    capturedByMarkSent: boolean().notNull().default(false),
    generatedById: uuid()
      .notNull()
      .references(() => users.id),
    generatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    organizationReference(t, t.quoteId, quotes).onDelete("cascade"),
    unique("quote_documents_quote_version_key").on(
      t.organizationId,
      t.quoteId,
      t.version
    ),
    unique("quote_documents_storage_key_key").on(t.storageKey),
    check("quote_documents_version_positive", sql`${t.version} > 0`),
    check("quote_documents_file_size_non_negative", sql`${t.fileSize} >= 0`),
    index().on(t.organizationId, t.quoteId, t.generatedAt),
  ]
)

export type QuoteDocumentRow = typeof quoteDocuments.$inferSelect
