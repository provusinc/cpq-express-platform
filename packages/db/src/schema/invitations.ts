import { sql } from "drizzle-orm"
import {
  check,
  index,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import { timestamps } from "../columns"
import { organizationTable } from "../organization-table"
import { users } from "./auth"
import { roleEnum } from "./memberships"

/**
 * An offer, sent to an email address, to join one Organization with a Role
 * (glossary: Invitation) — the only way a User gains a Membership.
 *
 * - `email` is stored lowercased; acceptance requires the signed-in User's
 *   email to match it.
 * - Only a SHA-256 hash of the emailed token is stored (`tokenHash`), so a
 *   database leak doesn't hand out working links. Resending replaces the hash
 *   and extends `expiresAt`, which invalidates the old link.
 * - Single use: `acceptedAt` / `revokedAt` end it. An Invitation is *open*
 *   while neither is set (it may still have expired), and an Organization
 *   has at most one open Invitation per email.
 */
export const invitations = organizationTable(
  "invitations",
  {
    email: text().notNull(),
    role: roleEnum().notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    /** The User who accepted (normally the one with `email`). */
    acceptedById: uuid().references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp({ withTimezone: true }),
    /** An Admin of the Organization, or a Platform Admin for the first Admin. */
    invitedById: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    check("invitations_email_lowercase", sql`${t.email} = lower(${t.email})`),
    uniqueIndex("invitations_open_email_key")
      .on(t.organizationId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    index().on(t.organizationId, t.createdAt),
  ]
)

export type Invitation = typeof invitations.$inferSelect
export type NewInvitation = typeof invitations.$inferInsert
