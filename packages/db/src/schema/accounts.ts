import { sql } from "drizzle-orm"
import { boolean, index, text, uniqueIndex, uuid } from "drizzle-orm/pg-core"

import { timestamps } from "../columns"
import { organizationReference, organizationTable } from "../organization-table"

/**
 * A company the Organization quotes (glossary: Account). Names are unique
 * within an Organization ignoring case and surrounding spaces (the
 * expression index below); the API also stores names trimmed.
 *
 * An Account with Quotes can only be archived: once Quotes exist they
 * reference it with ON DELETE RESTRICT, and the API refuses deletion with a
 * structured "in use" error. Archived Accounts are hidden from pickers.
 */
export const accounts = organizationTable(
  "accounts",
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
    uniqueIndex("accounts_organization_id_name_key").on(
      t.organizationId,
      sql`lower(btrim(${t.name}))`
    ),
    index().on(t.organizationId, t.archived),
  ]
)

export type Account = typeof accounts.$inferSelect
export type NewAccount = typeof accounts.$inferInsert

/**
 * A person at an Account (glossary: Contact). At most one per Account is the
 * primary Contact (partial unique index). Quotes never reference Contacts;
 * a Quote Document addresses its Account's primary Contact. Contacts go
 * with their Account and can always be deleted.
 */
export const contacts = organizationTable(
  "contacts",
  {
    accountId: uuid().notNull(),
    name: text().notNull(),
    email: text(),
    phone: text(),
    title: text(),
    isPrimary: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    organizationReference(t, t.accountId, accounts).onDelete("cascade"),
    index().on(t.organizationId, t.accountId),
    uniqueIndex("contacts_one_primary_per_account")
      .on(t.organizationId, t.accountId)
      .where(sql`${t.isPrimary}`),
  ]
)

export type Contact = typeof contacts.$inferSelect
export type NewContact = typeof contacts.$inferInsert
