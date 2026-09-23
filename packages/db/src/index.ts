import type { PgDatabase } from "drizzle-orm/pg-core"
import { drizzle } from "drizzle-orm/postgres-js"
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema"

export { schema }
export * from "drizzle-orm/sql"
export { TransactionRollbackError } from "drizzle-orm/errors"
export { uuidv7 } from "./columns"
export {
  organizationColumns,
  organizationReference,
  organizationTable,
} from "./organization-table"
export { organizationScope } from "./organization-scope"
export { createInvitationToken, hashInvitationToken } from "./invitation-token"
export { recomputeQuoteTotals } from "./quote-totals"
export type { QuoteTotalsRow, RecomputeResult } from "./quote-totals"
export type {
  OrganizationOwnedTable,
  OrganizationScope,
} from "./organization-scope"

/** Create a Drizzle client (and its postgres-js pool) for a connection URL. */
export function createDb(
  url: string,
  options: postgres.Options<Record<string, postgres.PostgresType>> = {}
) {
  const client = postgres(url, { onnotice: () => {}, ...options })
  return drizzle({ client, schema, casing: "snake_case" })
}

/** The concrete client returned by `createDb` (owns a pool, has `$client`). */
export type Database = ReturnType<typeof createDb>

/**
 * What server code should accept: either the root client or a transaction.
 * Nested `db.transaction()` calls on a transaction become savepoints, so code
 * written against `Db` works unchanged inside the test harness's rollback.
 */
export type Db = PgDatabase<PostgresJsQueryResultHKT, typeof schema>
