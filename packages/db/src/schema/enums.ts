import { pgEnum } from "drizzle-orm/pg-core"

import { QUOTE_STAGES } from "@workspace/domain/enums"

/**
 * Postgres enums shared by several areas, built from `@workspace/domain`
 * (area-specific enums live next to their table, e.g. `membership_role`).
 */

/**
 * Quote Stage (glossary). Used by `quotes.stage`, `quote_statuses.stage`,
 * the Approval Steps and Organization settings.
 */
export const quoteStageEnum = pgEnum("quote_stage", QUOTE_STAGES)
