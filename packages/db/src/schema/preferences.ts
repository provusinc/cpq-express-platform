import { sql } from "drizzle-orm"
import { pgTable, text, uuid } from "drizzle-orm/pg-core"

import { timestamps } from "../columns"
import { users } from "./auth"

/**
 * A User's own UI preferences, one row per User, typed columns only
 * (created on the first save; until then everything reads as its default).
 * Global like `users`: a preference follows the person across their
 * Organizations and devices.
 *
 * - `quoteListColumns` / `quoteListHiddenColumns`: the Quote list's column
 *   order and the columns they hid (column ids are the web app's; unknown
 *   ids are ignored when read, so renaming a column never breaks a row).
 */
export const userPreferences = pgTable("user_preferences", {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  quoteListColumns: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  quoteListHiddenColumns: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  ...timestamps(),
})

export type UserPreferences = typeof userPreferences.$inferSelect
