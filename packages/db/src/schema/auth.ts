import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { id, timestamps } from "../columns"

/**
 * Global identity tables used by Auth.js (Drizzle adapter, database sessions).
 * These are not business tables: a User exists once across CPQ Express and
 * reaches Organizations through Memberships (ADR-0001), so there is no
 * `organization_id` here.
 *
 * Column keys follow the adapter's expected names (including the snake_case
 * OAuth token fields on `accounts`); do not rename them.
 */
export const users = pgTable("users", {
  id: id(),
  name: text(),
  email: text().notNull().unique(),
  emailVerified: timestamp({ withTimezone: true, mode: "date" }),
  image: text(),
  /** Provus staff who operate CPQ Express itself (glossary: Platform Admin). */
  isPlatformAdmin: boolean().notNull().default(false),
  ...timestamps(),
})

/** Linked OAuth identities (Google, Microsoft Entra ID). */
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().notNull(),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    refresh_token: text(),
    access_token: text(),
    expires_at: integer(),
    token_type: text(),
    scope: text(),
    id_token: text(),
    session_state: text(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index().on(t.userId),
  ]
)

/** Database sessions; the token is the value of the session cookie. */
export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index().on(t.userId)]
)

/** Single-use magic-link tokens (stored hashed by Auth.js). */
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })]
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
