import { getTableName } from "drizzle-orm"
import { foreignKey, pgTable, unique, uuid } from "drizzle-orm/pg-core"
import type {
  AnyPgColumn,
  PgColumnBuilderBase,
  PgTableExtraConfigValue,
} from "drizzle-orm/pg-core"
import type { BuildExtraConfigColumns } from "drizzle-orm"

import { id } from "./columns"
import { organizations } from "./schema/organizations"

/**
 * Business tables (ADR-0001). Every row belongs to exactly one Organization,
 * and a row can never reference another Organization's row:
 *
 * 1. Declare the table with `organizationTable` instead of `pgTable`. It adds
 *    `id` (UUIDv7 primary key), `organization_id` (→ organizations.id) and a
 *    unique `(organization_id, id)` key that other business tables point at.
 * 2. Reference another business table with `organizationReference` in the
 *    extra config: a composite foreign key `(organization_id, x_id) →
 *    x(organization_id, id)`, so Postgres itself rejects a cross-Organization
 *    link. Keep the plain `xId: uuid()` column; don't add `.references()`.
 *
 *   export const contacts = organizationTable(
 *     "contacts",
 *     { accountId: uuid().notNull(), name: text().notNull(), ...timestamps() },
 *     (t) => [
 *       organizationReference(t, t.accountId, accounts).onDelete("cascade"),
 *       index().on(t.organizationId, t.accountId),
 *     ]
 *   )
 *
 * - Nullable references (e.g. a Line Item's Phase) work the same way: a NULL
 *   `x_id` skips the check (MATCH SIMPLE). Don't use `onDelete("set null")`
 *   — it would null `organization_id` too; clear the column in the command.
 * - Global tables (users, sessions, …) are referenced with a plain
 *   `.references()`; only business → business links are composite.
 * - Query business tables through the Organization scope
 *   (`organizationScope`, `ctx.scope` in the API), never bare.
 */
export function organizationColumns() {
  return {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
  }
}

type OrganizationColumns = ReturnType<typeof organizationColumns>

/** `pgTable` for a business table: see the recipe above. */
export function organizationTable<
  TName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
>(
  name: TName,
  columns: TColumns,
  extraConfig?: (
    self: BuildExtraConfigColumns<TName, OrganizationColumns & TColumns, "pg">
  ) => PgTableExtraConfigValue[]
) {
  return pgTable(
    name,
    { ...organizationColumns(), ...columns } as OrganizationColumns & TColumns,
    (t) => [
      unique(`${name}_organization_id_id_key`).on(t.organizationId, t.id),
      ...(extraConfig?.(t) ?? []),
    ]
  )
}

/**
 * Composite foreign key from `column` on a business table to another business
 * table's `(organization_id, id)`. Chain `.onDelete()` / `.onUpdate()` as
 * usual. Named `<table>_<column>_fk` unless `name` is given (Postgres
 * truncates names past 63 characters).
 */
export function organizationReference(
  self: { organizationId: AnyPgColumn },
  column: AnyPgColumn,
  target: { organizationId: AnyPgColumn; id: AnyPgColumn },
  name?: string
) {
  return foreignKey({
    name: name ?? `${getTableName(column.table)}_${snakeCase(column.name)}_fk`,
    columns: [self.organizationId, column],
    foreignColumns: [target.organizationId, target.id],
  })
}

const snakeCase = (key: string) =>
  key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
