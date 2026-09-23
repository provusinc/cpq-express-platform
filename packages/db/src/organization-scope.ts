import { and, eq } from "drizzle-orm"
import type { InferInsertModel, InferSelectModel, SQL } from "drizzle-orm"
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core"

import type { Db } from "./index"

/** A business table: declared with `organizationTable`. */
export type OrganizationOwnedTable = PgTable & {
  id: AnyPgColumn
  organizationId: AnyPgColumn
}

type Row<T extends OrganizationOwnedTable> = InferSelectModel<T>
/** Insert values without `organizationId` — the scope supplies it. */
type Values<T extends OrganizationOwnedTable> = Omit<
  InferInsertModel<T>,
  "organizationId"
>
type Changes<T extends OrganizationOwnedTable> = Partial<
  Omit<InferInsertModel<T>, "organizationId" | "id">
>

/**
 * Data access bound to one Organization. Every read, write and delete is
 * filtered by (or stamped with) `organization_id`, so a handler can't reach
 * another Organization's rows even with a known id; a missing row comes back
 * as `undefined` for the caller to turn into NOT_FOUND.
 *
 * For joins and anything the helpers don't cover, use `scope.db` with
 * `scope.where(table, …)` on every business table in the query.
 */
export interface OrganizationScope {
  readonly organizationId: string
  /** The underlying handle (root client or transaction). */
  readonly db: Db
  /** `table.organization_id = <this Organization> AND …conditions`. */
  where(table: OrganizationOwnedTable, ...conditions: (SQL | undefined)[]): SQL
  findById<T extends OrganizationOwnedTable>(
    table: T,
    id: string
  ): Promise<Row<T> | undefined>
  findMany<T extends OrganizationOwnedTable>(
    table: T,
    opts?: {
      where?: SQL
      orderBy?: (SQL | AnyPgColumn)[]
      limit?: number
    }
  ): Promise<Row<T>[]>
  insert<T extends OrganizationOwnedTable>(
    table: T,
    values: Values<T>
  ): Promise<Row<T>>
  insertMany<T extends OrganizationOwnedTable>(
    table: T,
    values: Values<T>[]
  ): Promise<Row<T>[]>
  /** Updates one row by id; `undefined` when it isn't this Organization's. */
  update<T extends OrganizationOwnedTable>(
    table: T,
    id: string,
    changes: Changes<T>
  ): Promise<Row<T> | undefined>
  /** Deletes one row by id; returns it, or `undefined` when not found. */
  delete<T extends OrganizationOwnedTable>(
    table: T,
    id: string
  ): Promise<Row<T> | undefined>
  /** Runs `fn` in a transaction (a savepoint when already in one). */
  transaction<R>(fn: (scope: OrganizationScope) => Promise<R>): Promise<R>
}

export function organizationScope(
  db: Db,
  organizationId: string
): OrganizationScope {
  const where: OrganizationScope["where"] = (table, ...conditions) =>
    and(eq(table.organizationId, organizationId), ...conditions)!

  // Drizzle's builders can't infer row types through a generic table, so the
  // queries run on `PgTable` and the public signatures carry the row types.
  const scope: OrganizationScope = {
    organizationId,
    db,
    where,

    async findById(table, id) {
      const [row] = await db
        .select()
        .from(table as PgTable)
        .where(where(table, eq(table.id, id)))
        .limit(1)
      return row as never
    },

    async findMany(table, opts = {}) {
      const query = db
        .select()
        .from(table as PgTable)
        .where(where(table, opts.where))
        .orderBy(...(opts.orderBy ?? []))
      return (await (opts.limit === undefined
        ? query
        : query.limit(opts.limit))) as never
    },

    async insert(table, values) {
      const [row] = await scope.insertMany(table, [values])
      return row!
    },

    async insertMany(table, values) {
      if (values.length === 0) return []
      return (await db
        .insert(table as PgTable)
        .values(values.map((v) => ({ ...v, organizationId })) as never)
        .returning()) as never
    },

    async update(table, id, changes) {
      // Never let a caller move a row to another Organization or re-key it.
      const set: Record<string, unknown> = { ...changes }
      delete set.organizationId
      delete set.id
      if (Object.keys(set).length === 0) return scope.findById(table, id)
      const [row] = await db
        .update(table as PgTable)
        .set(set as never)
        .where(where(table, eq(table.id, id)))
        .returning()
      return row as never
    },

    async delete(table, id) {
      const [row] = await db
        .delete(table as PgTable)
        .where(where(table, eq(table.id, id)))
        .returning()
      return row as never
    },

    transaction: (fn) =>
      db.transaction((tx) => fn(organizationScope(tx, organizationId))),
  }
  return scope
}
