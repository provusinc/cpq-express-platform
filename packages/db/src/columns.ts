import { timestamp, uuid } from "drizzle-orm/pg-core"
import { v7 as uuidv7 } from "uuid"

/**
 * Shared column builders for schema files (`import { id, timestamps } from "../columns"`).
 *
 * Primary keys are UUIDv7 generated in the application (Postgres 17 has no
 * native uuidv7()). They are time-ordered, so B-tree inserts stay local, and
 * an id is known before the INSERT (handy for building graphs in one command).
 */
export const id = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7())

/** `created_at` / `updated_at`, both `timestamptz`, set by the application. */
export const timestamps = () => ({
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

export { uuidv7 }
