import {
  index,
  jsonb,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { timestamps } from "../columns"
import { organizationReference, organizationTable } from "../organization-table"
import { users } from "./auth"
import { quotes } from "./quotes"

/**
 * What a destructive Quote command removed, kept briefly so the user can
 * undo it (ADR-0003: "destructive commands offer a short-lived undo").
 * The command returns the row's id as `undoToken`; the matching restore
 * command re-inserts `payload` once and deletes the row. The snapshot lives
 * on the server, so a restore can't smuggle in prices, costs or totals the
 * client made up.
 *
 * `kind` names the command that wrote it (e.g. `line_items.delete`;
 * Phase delete in #14 adds its own) and `payload` is that command's JSON
 * snapshot. Rows past `expiresAt` are refused and purged opportunistically.
 */
export const undoSnapshots = organizationTable(
  "undo_snapshots",
  {
    quoteId: uuid().notNull(),
    kind: text().notNull(),
    payload: jsonb().notNull(),
    createdById: uuid()
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [
    organizationReference(t, t.quoteId, quotes).onDelete("cascade"),
    index().on(t.organizationId, t.expiresAt),
  ]
)

export type UndoSnapshot = typeof undoSnapshots.$inferSelect
