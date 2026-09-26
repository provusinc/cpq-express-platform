import { sql } from "drizzle-orm"
import { boolean, index, text, uniqueIndex, uuid } from "drizzle-orm/pg-core"

import { timestamps } from "../columns"
import { organizationReference, organizationTable } from "../organization-table"

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
    /** Free text (e.g. "Customer - Direct", "Prospect"); filters use the values in use. */
    type: text(),
    industry: text(),
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
