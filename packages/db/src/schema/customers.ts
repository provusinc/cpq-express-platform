import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { CUSTOMER_CLASSIFICATION_KINDS } from "@workspace/domain/enums"

import { timestamps } from "../columns"
import { organizationReference, organizationTable } from "../organization-table"

/** Which value list a Customer classification belongs to. */
export const customerClassificationKindEnum = pgEnum(
  "customer_classification_kind",
  CUSTOMER_CLASSIFICATION_KINDS
)

/**
 * The Organization's Customer Types and Industries (glossary: Customer Type /
 * Industry), one table told apart by `kind`. Every Organization starts with
 * `DEFAULT_CUSTOMER_CLASSIFICATIONS` (`createDefaultCustomerClassifications`).
 *
 * - `name` is unique per Organization and kind, ignoring case (the API
 *   stores it trimmed).
 * - `sequence` orders a list (pickers, filters, Settings).
 * - `retired_at` set = retired: kept on the Customers that have it, no
 *   longer offered. A value in use can't be deleted (the Customers'
 *   references RESTRICT); retire it instead.
 * - The kind of a Customer's reference (`customer_type_id` → a
 *   `customer_type` value) is checked by the API.
 */
export const customerClassifications = organizationTable(
  "customer_classifications",
  {
    kind: customerClassificationKindEnum().notNull(),
    name: text().notNull(),
    sequence: integer().notNull(),
    retiredAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("customer_classifications_organization_id_kind_name_key").on(
      t.organizationId,
      t.kind,
      sql`lower(${t.name})`
    ),
    index().on(t.organizationId, t.kind, t.sequence),
    check(
      "customer_classifications_name_not_blank",
      sql`btrim(${t.name}) <> ''`
    ),
    check(
      "customer_classifications_sequence_non_negative",
      sql`${t.sequence} >= 0`
    ),
  ]
)

export type CustomerClassificationRow =
  typeof customerClassifications.$inferSelect

/**
 * A customer the Organization quotes (glossary: Customer). Names are unique
 * within an Organization ignoring case and surrounding spaces (the
 * expression index below); the API also stores names trimmed.
 *
 * A Customer with Quotes can only be archived: once Quotes exist they
 * reference it with ON DELETE RESTRICT, and the API refuses deletion with a
 * structured "in use" error. Archived Customers are hidden from pickers.
 */
export const customers = organizationTable(
  "customers",
  {
    name: text().notNull(),
    /** The Customer Type (a `customer_type` classification), optional. */
    customerTypeId: uuid(),
    /** The Industry (an `industry` classification), optional. */
    industryId: uuid(),
    website: text(),
    phone: text(),
    billingStreet: text(),
    billingCity: text(),
    billingState: text(),
    billingPostalCode: text(),
    billingCountry: text(),
    archived: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("customers_organization_id_name_key").on(
      t.organizationId,
      sql`lower(btrim(${t.name}))`
    ),
    index().on(t.organizationId, t.archived),
    organizationReference(
      t,
      t.customerTypeId,
      customerClassifications
    ).onDelete("restrict"),
    organizationReference(t, t.industryId, customerClassifications).onDelete(
      "restrict"
    ),
    index().on(t.organizationId, t.customerTypeId),
    index().on(t.organizationId, t.industryId),
  ]
)

export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert

/**
 * A person at a Customer (glossary: Contact). At most one per Customer is the
 * primary Contact (partial unique index). Quotes never reference Contacts;
 * a Quote Document addresses its Customer's primary Contact. Contacts go
 * with their Customer and can always be deleted.
 */
export const contacts = organizationTable(
  "contacts",
  {
    customerId: uuid().notNull(),
    name: text().notNull(),
    email: text(),
    phone: text(),
    title: text(),
    isPrimary: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    organizationReference(t, t.customerId, customers).onDelete("cascade"),
    index().on(t.organizationId, t.customerId),
    uniqueIndex("contacts_one_primary_per_customer")
      .on(t.organizationId, t.customerId)
      .where(sql`${t.isPrimary}`),
  ]
)

export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
