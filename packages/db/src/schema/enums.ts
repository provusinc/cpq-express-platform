import { pgEnum } from "drizzle-orm/pg-core"

import { QUOTE_STATUSES } from "@workspace/domain/enums"

/**
 * Postgres enums shared by several areas, built from `@workspace/domain`
 * (area-specific enums live next to their table, e.g. `membership_role`).
 */

/** Quote Status (glossary). Used by Organization settings now, Quotes later. */
export const quoteStatusEnum = pgEnum("quote_status", QUOTE_STATUSES)
