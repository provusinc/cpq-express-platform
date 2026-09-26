/**
 * Settings → Customer fields (#31): an Admin manages the Organization's two
 * Customer value lists, Customer Types and Industries (glossary: Customer
 * Type / Industry). Spread into the settings router.
 *
 * - A value in use can't be deleted (`inUseError`, suggesting retire); a
 *   retired value stays on the Customers that have it and is no longer
 *   offered. A rename shows everywhere (Customers reference the value).
 * - Every command locks the list's values (`FOR UPDATE`) first, so name
 *   uniqueness and the order hold under concurrent edits; the unique index
 *   on `(organization_id, kind, lower(name))` backs the former.
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { asc, eq, inArray, or, schema, sql } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import {
  checkClassificationName,
  CUSTOMER_CLASSIFICATIONS_PER_KIND_MAX,
} from "@workspace/domain/customers"
import {
  CUSTOMER_CLASSIFICATION_KIND_LABELS,
  CUSTOMER_CLASSIFICATION_KINDS,
} from "@workspace/domain/enums"
import type { CustomerClassificationKind } from "@workspace/domain/enums"

import {
  IN_USE_EXAMPLE_LIMIT,
  inUseError,
  isUniqueViolation,
  notFound,
} from "../errors"
import { organizationProcedure, permittedProcedure } from "../trpc"

const { customerClassifications, customers } = schema

const NAME_KEY = "customer_classifications_organization_id_kind_name_key"

const manageSettings = permittedProcedure("settings.manage")

interface ValueRow {
  id: string
  kind: CustomerClassificationKind
  name: string
  sequence: number
  retiredAt: Date | null
}

const columns = {
  id: customerClassifications.id,
  kind: customerClassifications.kind,
  name: customerClassifications.name,
  sequence: customerClassifications.sequence,
  retiredAt: customerClassifications.retiredAt,
}

/** One value as Settings, pickers and filters show it. */
const view = (row: ValueRow, customerCount = 0) => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  sequence: row.sequence,
  retired: row.retiredAt !== null,
  customerCount,
})

export type CustomerClassificationView = ReturnType<typeof view>

/** One value of the scope's Organization, or undefined. */
async function findValue(scope: OrganizationScope, id: string) {
  const [row] = await scope.db
    .select(columns)
    .from(customerClassifications)
    .where(
      scope.where(customerClassifications, eq(customerClassifications.id, id))
    )
  return row as ValueRow | undefined
}

/** A list's values, locked for the rest of the transaction, in order. */
async function lockList(
  scope: OrganizationScope,
  kind: CustomerClassificationKind
): Promise<ValueRow[]> {
  return scope.db
    .select(columns)
    .from(customerClassifications)
    .where(
      scope.where(
        customerClassifications,
        eq(customerClassifications.kind, kind)
      )
    )
    .orderBy(
      asc(customerClassifications.sequence),
      asc(customerClassifications.id)
    )
    .for("update")
}

/** Refuses a name another value of the list already has (CONFLICT). */
function checkName(
  kind: CustomerClassificationKind,
  values: ValueRow[],
  name: string,
  exceptId?: string
) {
  const check = checkClassificationName(
    kind,
    name,
    values.filter((v) => v.id !== exceptId).map((v) => v.name)
  )
  if (!check.ok) {
    throw new TRPCError({
      code: check.reason === "duplicate" ? "CONFLICT" : "BAD_REQUEST",
      message: check.message,
    })
  }
  return check.name
}

/** Turns a lost race on the name index into the same CONFLICT. */
async function guardName<T>(
  kind: CustomerClassificationKind,
  name: string,
  write: () => Promise<T>
) {
  try {
    return await write()
  } catch (error) {
    if (isUniqueViolation(error, NAME_KEY)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `${CUSTOMER_CLASSIFICATION_KIND_LABELS[kind].singular} “${name}” already exists.`,
      })
    }
    throw error
  }
}

/** The Customers that have the value (either list), as a condition. */
const hasValue = (id: string) =>
  or(eq(customers.customerTypeId, id), eq(customers.industryId, id))

/** How many Customers have the value, with the first few names. */
async function valueUsage(scope: OrganizationScope, id: string) {
  const rows = await scope.db
    .select({
      name: customers.name,
      total: sql<number>`count(*) over ()`.mapWith(Number),
    })
    .from(customers)
    .where(scope.where(customers, hasValue(id)))
    .orderBy(asc(sql`lower(${customers.name})`))
    .limit(IN_USE_EXAMPLE_LIMIT)
  return { count: rows[0]?.total ?? 0, examples: rows.map((r) => r.name) }
}

/** A value's name, checked by the domain (trimmed, not blank, not too long). */
const nameInput = z.string().max(1000)

export const customerClassificationSettingsProcedures = {
  /**
   * Both lists' values (Customer Types first, then Industries), each in its
   * order, retired ones included, with how many Customers have each. Any
   * member: the Customer dialog and the Customers list's filters read it.
   */
  customerClassifications: organizationProcedure.query(async ({ ctx }) => {
    const usage = ctx.scope.db
      .select({ n: sql<number>`count(*)` })
      .from(customers)
      .where(
        ctx.scope.where(
          customers,
          or(
            eq(customers.customerTypeId, customerClassifications.id),
            eq(customers.industryId, customerClassifications.id)
          )
        )
      )
    const rows = await ctx.scope.db
      .select({ ...columns, customerCount: sql<number>`(${usage})::int` })
      .from(customerClassifications)
      .where(ctx.scope.where(customerClassifications))
      .orderBy(
        asc(customerClassifications.kind),
        asc(customerClassifications.sequence),
        asc(customerClassifications.id)
      )
    return rows.map((row) => view(row, row.customerCount))
  }),

  /**
   * Adds a value at the end of its list. A name the list already has
   * (ignoring case) → CONFLICT; at most `CUSTOMER_CLASSIFICATIONS_PER_KIND_MAX`
   * per list → PRECONDITION_FAILED.
   */
  createCustomerClassification: manageSettings
    .input(
      z.object({ kind: z.enum(CUSTOMER_CLASSIFICATION_KINDS), name: nameInput })
    )
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const values = await lockList(scope, input.kind)
        const name = checkName(input.kind, values, input.name)
        if (values.length >= CUSTOMER_CLASSIFICATIONS_PER_KIND_MAX) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `A list holds at most ${CUSTOMER_CLASSIFICATIONS_PER_KIND_MAX} values.`,
          })
        }
        const sequence = Math.max(-1, ...values.map((v) => v.sequence)) + 1
        const row = await guardName(input.kind, name, () =>
          scope.insert(customerClassifications, {
            kind: input.kind,
            name,
            sequence,
          })
        )
        return view(row)
      })
    ),

  /**
   * Renames a value and/or retires it (`retired: true`: kept on its
   * Customers, no longer offered) or brings it back (`retired: false`).
   */
  updateCustomerClassification: manageSettings
    .input(
      z.object({
        id: z.uuid(),
        name: nameInput.optional(),
        retired: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const found = await findValue(scope, input.id)
        if (!found) throw notFound("Value")
        const values = await lockList(scope, found.kind)
        const current = values.find((v) => v.id === found.id)!
        const name =
          input.name === undefined
            ? undefined
            : checkName(found.kind, values, input.name, current.id)
        const changes = {
          ...(name !== undefined && name !== current.name ? { name } : {}),
          ...(input.retired !== undefined &&
          input.retired !== (current.retiredAt !== null)
            ? { retiredAt: input.retired ? new Date() : null }
            : {}),
        }
        const row =
          Object.keys(changes).length === 0
            ? current
            : await guardName(found.kind, name ?? current.name, async () => {
                const updated = await scope.update(
                  customerClassifications,
                  current.id,
                  { ...changes, updatedAt: new Date() }
                )
                if (!updated) throw notFound("Value")
                return updated
              })
        return view(row, (await valueUsage(scope, current.id)).count)
      })
    ),

  /**
   * Puts a list's values in the given order; `ids` must be exactly that
   * list's values (another Organization's id → NOT_FOUND, anything else
   * missing or repeated → BAD_REQUEST).
   */
  reorderCustomerClassifications: manageSettings
    .input(
      z.object({
        kind: z.enum(CUSTOMER_CLASSIFICATION_KINDS),
        ids: z
          .array(z.uuid())
          .min(1)
          .max(CUSTOMER_CLASSIFICATIONS_PER_KIND_MAX),
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const values = await lockList(scope, input.kind)
        const known = new Set(values.map((v) => v.id))
        if (
          new Set(input.ids).size !== input.ids.length ||
          input.ids.length !== values.length ||
          !input.ids.every((id) => known.has(id))
        ) {
          const ours = await scope.findMany(customerClassifications, {
            where: inArray(customerClassifications.id, input.ids),
          })
          if (ours.length !== new Set(input.ids).size) throw notFound("Value")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "List every value of the list exactly once.",
          })
        }
        for (const [sequence, id] of input.ids.entries()) {
          const current = values.find((v) => v.id === id)!
          if (current.sequence !== sequence) {
            await scope.update(customerClassifications, id, {
              sequence,
              updatedAt: new Date(),
            })
          }
        }
        return input.ids.map((id, sequence) =>
          view({ ...values.find((v) => v.id === id)!, sequence })
        )
      })
    ),

  /**
   * Deletes an unused value. CONFLICT (`data.inUse`, suggesting retire) while
   * any Customer has it.
   */
  deleteCustomerClassification: manageSettings
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const found = await findValue(scope, input.id)
        if (!found) throw notFound("Value")
        await lockList(scope, found.kind)
        const usage = await valueUsage(scope, found.id)
        if (usage.count > 0) {
          throw inUseError({
            entity: found.kind,
            name: found.name,
            counts: { customers: usage.count },
            examples: usage.examples,
            suggestion: "retire",
          })
        }
        await scope.delete(customerClassifications, found.id)
        return { id: found.id, kind: found.kind }
      })
    ),
}
