import { TRPCError } from "@trpc/server"
import { z } from "zod"

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  ne,
  or,
  schema,
  sql,
} from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"

import {
  IN_USE_EXAMPLE_LIMIT,
  inUseError,
  isUniqueViolation,
  notFound,
} from "../errors"
import type { InUseCounts } from "../errors"
import {
  containsPattern,
  optionalText,
  paging,
  requiredText,
  stripUndefined,
} from "../inputs"
import { createTRPCRouter, organizationProcedure } from "../trpc"

const { customers, contacts, quotes } = schema

/** Customer fields a user edits (name handled separately: it's unique). */
const customerFields = {
  type: optionalText(100),
  industry: optionalText(100),
  website: optionalText(500),
  phone: optionalText(50),
  billingStreet: optionalText(500),
  billingCity: optionalText(100),
  billingState: optionalText(100),
  billingPostalCode: optionalText(20),
  billingCountry: optionalText(100),
}

const NAME_KEY = "customers_organization_id_name_key"

function duplicateName(name: string) {
  return new TRPCError({
    code: "CONFLICT",
    message: `A Customer named “${name}” already exists.`,
  })
}

/** Refuses a name already used by another Customer (ignoring case and spaces). */
async function assertNameFree(
  scope: OrganizationScope,
  name: string,
  exceptId?: string
) {
  const [clash] = await scope.findMany(customers, {
    where: and(
      sql`lower(btrim(${customers.name})) = lower(btrim(${name}))`,
      exceptId ? ne(customers.id, exceptId) : undefined
    ),
    limit: 1,
  })
  if (clash) throw duplicateName(clash.name)
}

/** Runs a write, turning a lost race on the unique name into CONFLICT. */
async function withNameGuard<T>(name: string, write: () => Promise<T>) {
  try {
    return await write()
  } catch (error) {
    if (isUniqueViolation(error, NAME_KEY)) throw duplicateName(name)
    throw error
  }
}

/**
 * What references each Customer and would block its deletion: its Quotes
 * (which also RESTRICT the delete in the database), counted, with the
 * newest few Quote names as examples.
 */
async function customerUsage(
  scope: OrganizationScope,
  ids: string[]
): Promise<Map<string, { counts: InUseCounts; examples: string[] }>> {
  const usage = new Map<string, { counts: InUseCounts; examples: string[] }>(
    ids.map((id) => [id, { counts: {}, examples: [] }])
  )
  if (ids.length === 0) return usage
  const ranked = scope.db
    .select({
      customerId: quotes.customerId,
      name: quotes.name,
      rank: sql<number>`row_number() over (partition by ${quotes.customerId} order by ${quotes.createdAt} desc, ${quotes.id} desc)`.as(
        "rank"
      ),
      total: sql<number>`count(*) over (partition by ${quotes.customerId})`.as(
        "total"
      ),
    })
    .from(quotes)
    .where(scope.where(quotes, inArray(quotes.customerId, ids)))
    .as("ranked")
  const rows = await scope.db
    .select()
    .from(ranked)
    .where(sql`${ranked.rank} <= ${IN_USE_EXAMPLE_LIMIT}`)
    .orderBy(asc(ranked.rank))
  for (const row of rows) {
    const used = usage.get(row.customerId)!
    used.counts.quotes = Number(row.total)
    used.examples.push(row.name)
  }
  return usage
}

/** Throws the structured "in use" CONFLICT for the first referenced Customer. */
async function assertDeletable(
  scope: OrganizationScope,
  rows: { id: string; name: string }[]
) {
  const usage = await customerUsage(
    scope,
    rows.map((r) => r.id)
  )
  for (const row of rows) {
    const used = usage.get(row.id)
    if (used && Object.values(used.counts).some((n) => n > 0)) {
      throw inUseError({
        entity: "customer",
        name: row.name,
        counts: used.counts,
        examples: used.examples,
        suggestion: "archive",
      })
    }
  }
}

const primaryContacts = schema.contacts

export const customerRouter = createTRPCRouter({
  /**
   * One page of Customers, by name. `search` matches name, industry and
   * website; `type` and `industry` match exactly; `status` defaults to the
   * unarchived Customers.
   */
  list: organizationProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        type: z.string().optional(),
        industry: z.string().optional(),
        status: z.enum(["active", "archived", "all"]).default("active"),
        ...paging,
      })
    )
    .query(async ({ ctx, input }) => {
      // Every filter but the status: the Active / Archived tabs count under these.
      const others = ctx.scope.where(
        customers,
        input.search
          ? or(
              ilike(customers.name, containsPattern(input.search)),
              ilike(customers.industry, containsPattern(input.search)),
              ilike(customers.website, containsPattern(input.search))
            )
          : undefined,
        input.type ? eq(customers.type, input.type) : undefined,
        input.industry ? eq(customers.industry, input.industry) : undefined
      )
      const where =
        input.status === "all"
          ? others
          : and(others, eq(customers.archived, input.status === "archived"))
      const contactCount = ctx.scope.db
        .select({ n: count() })
        .from(contacts)
        .where(ctx.scope.where(contacts, eq(contacts.customerId, customers.id)))
      const [rows, [counts]] = await Promise.all([
        ctx.scope.db
          .select({
            id: customers.id,
            name: customers.name,
            type: customers.type,
            industry: customers.industry,
            website: customers.website,
            phone: customers.phone,
            billingCity: customers.billingCity,
            billingState: customers.billingState,
            billingCountry: customers.billingCountry,
            archived: customers.archived,
            primaryContact: {
              id: primaryContacts.id,
              name: primaryContacts.name,
              email: primaryContacts.email,
            },
            contactCount: sql<number>`(${contactCount})::int`,
          })
          .from(customers)
          .leftJoin(
            primaryContacts,
            and(
              eq(primaryContacts.organizationId, customers.organizationId),
              eq(primaryContacts.customerId, customers.id),
              eq(primaryContacts.isPrimary, true)
            )
          )
          .where(where)
          .orderBy(asc(sql`lower(${customers.name})`), asc(customers.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        ctx.scope.db
          .select({
            active:
              sql<number>`count(*) filter (where not ${customers.archived})`.mapWith(
                Number
              ),
            archived:
              sql<number>`count(*) filter (where ${customers.archived})`.mapWith(
                Number
              ),
          })
          .from(customers)
          .where(others),
      ])
      const statusCounts = {
        active: counts?.active ?? 0,
        archived: counts?.archived ?? 0,
        all: (counts?.active ?? 0) + (counts?.archived ?? 0),
      }
      return {
        rows: rows.map((r) => ({
          ...r,
          primaryContact: r.primaryContact?.id ? r.primaryContact : null,
        })),
        total: statusCounts[input.status],
        /** Counts per status tab under the other filters. */
        statusCounts,
        page: input.page,
        pageSize: input.pageSize,
      }
    }),

  /** The distinct types and industries in use, for the list filters. */
  filterOptions: organizationProcedure.query(async ({ ctx }) => {
    const distinct = async (
      column: typeof customers.type | typeof customers.industry
    ) => {
      const rows = await ctx.scope.db
        .selectDistinct({ value: column })
        .from(customers)
        .where(ctx.scope.where(customers, isNotNull(column)))
        .orderBy(asc(column))
      return rows.map((r) => r.value!)
    }
    const [types, industries] = await Promise.all([
      distinct(customers.type),
      distinct(customers.industry),
    ])
    return { types, industries }
  }),

  /**
   * Unarchived Customers for a picker (e.g. a Quote's Customer), by name.
   * `includeId` also returns that Customer even when archived, so a form can
   * show its current value.
   */
  listForPicker: organizationProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        includeId: z.uuid().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.scope.db
        .select({
          id: customers.id,
          name: customers.name,
          archived: customers.archived,
        })
        .from(customers)
        .where(
          ctx.scope.where(
            customers,
            or(
              and(
                eq(customers.archived, false),
                input.search
                  ? ilike(customers.name, containsPattern(input.search))
                  : undefined
              ),
              input.includeId ? eq(customers.id, input.includeId) : undefined
            )
          )
        )
        .orderBy(asc(sql`lower(${customers.name})`))
        .limit(input.limit)
      return rows
    }),

  /** One Customer with its Contacts (primary first, then by name). */
  byId: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const customer = await ctx.scope.findById(customers, input.id)
      if (!customer) throw notFound("Customer")
      const customerContacts = await ctx.scope.findMany(contacts, {
        where: eq(contacts.customerId, customer.id),
        orderBy: [
          desc(contacts.isPrimary),
          asc(sql`lower(${contacts.name})`),
          asc(contacts.id),
        ],
      })
      return { ...customer, contacts: customerContacts }
    }),

  /** Creates a Customer. CONFLICT when the name is taken. */
  create: organizationProcedure
    .input(z.object({ name: requiredText(200), ...customerFields }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        await assertNameFree(scope, input.name)
        return withNameGuard(input.name, () =>
          scope.insert(customers, stripUndefined(input))
        )
      })
    ),

  /** Edits a Customer's details. Omitted fields keep their value. */
  update: organizationProcedure
    .input(
      z.object({
        id: z.uuid(),
        name: requiredText(200).optional(),
        ...customerFields,
      })
    )
    .mutation(({ ctx, input: { id, ...changes } }) =>
      ctx.scope.transaction(async (scope) => {
        if (!(await scope.findById(customers, id))) throw notFound("Customer")
        if (changes.name) await assertNameFree(scope, changes.name, id)
        const updated = await withNameGuard(changes.name ?? "", () =>
          scope.update(customers, id, stripUndefined(changes))
        )
        if (!updated) throw notFound("Customer")
        return updated
      })
    ),

  /** Archives a Customer: kept with its Quotes, hidden from pickers. */
  archive: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.scope.update(customers, input.id, {
        archived: true,
      })
      if (!updated) throw notFound("Customer")
      return updated
    }),

  /** Brings an archived Customer back into pickers. */
  unarchive: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.scope.update(customers, input.id, {
        archived: false,
      })
      if (!updated) throw notFound("Customer")
      return updated
    }),

  /**
   * Deletes a Customer and its Contacts. CONFLICT (`data.inUse`) when Quotes
   * use it — archive it instead.
   */
  delete: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const customer = await scope.findById(customers, input.id)
        if (!customer) throw notFound("Customer")
        await assertDeletable(scope, [customer])
        await scope.delete(customers, customer.id)
        return { id: customer.id }
      })
    ),

  /**
   * Deletes several Customers, all or none: NOT_FOUND if any id isn't this
   * Organization's, CONFLICT (`data.inUse`) if any is used by Quotes.
   */
  deleteMany: organizationProcedure
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(100) }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const ids = [...new Set(input.ids)]
        const rows = await scope.findMany(customers, {
          where: inArray(customers.id, ids),
          orderBy: [asc(customers.name)],
        })
        if (rows.length !== ids.length) throw notFound("Customer")
        await assertDeletable(scope, rows)
        await scope.db
          .delete(customers)
          .where(scope.where(customers, inArray(customers.id, ids)))
        return { ids }
      })
    ),
})
