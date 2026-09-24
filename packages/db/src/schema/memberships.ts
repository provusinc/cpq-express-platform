import { boolean, index, pgEnum, unique, uuid } from "drizzle-orm/pg-core"

import { ROLES } from "@workspace/domain/enums"

import { timestamps } from "../columns"
import { organizationTable } from "../organization-table"
import { users } from "./auth"

/** Membership Roles (glossary: Role), from `@workspace/domain`. */
export const roleEnum = pgEnum("membership_role", ROLES)

/**
 * A User's belonging to one Organization (glossary: Membership), carrying
 * their Role and the independent Approver right. One per (Organization, User).
 * A business table: it has `organization_id` and the `(organization_id, id)`
 * key, so Organization-owned rows (e.g. approval steps) can point at it.
 */
export const memberships = organizationTable(
  "memberships",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum().notNull(),
    /** Glossary: Approver — may approve or reject submitted Quotes. */
    isApprover: boolean().notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique("memberships_organization_id_user_id_key").on(
      t.organizationId,
      t.userId
    ),
    index().on(t.userId),
  ]
)

export type Membership = typeof memberships.$inferSelect
export type NewMembership = typeof memberships.$inferInsert
