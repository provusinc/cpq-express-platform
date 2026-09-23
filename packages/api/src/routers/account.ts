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

const { accounts, contacts, quotes } = schema

/** Account fields a user edits (name handled separately: it's unique). */
const accountFields = {
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

const NAME_KEY = "accounts_organization_id_name_key"

function duplicateName(name: string) {
  return new TRPCError({
    code: "CONFLICT",
    message: `An Account named “${name}” already exists.`,
  })
}

/** Refuses a name already used by another Account (ignoring case and spaces). */
async function assertNameFree(
  scope: OrganizationScope,
  name: string,
  exceptId?: string
) {
  const [clash] = await scope.findMany(accounts, {
    where: and(
      sql`lower(btrim(${accounts.name})) = lower(btrim(${name}))`,
      exceptId ? ne(accounts.id, exceptId) : undefined
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
 * What references each Account and would block its deletion: its Quotes
 * (which also RESTRICT the delete in the database), counted, with the
 * newest few Quote names as examples.
 */
async function accountUsage(
  scope: OrganizationScope,
  ids: string[]
): Promise<Map<string, { counts: InUseCounts; examples: string[] }>> {
  const usage = new Map<string, { counts: InUseCounts; examples: string[] }>(
    ids.map((id) => [id, { counts: {}, examples: [] }])
  )
  if (ids.length === 0) return usage
  const ranked = scope.db
    .select({
      accountId: quotes.accountId,
      name: quotes.name,
      rank: sql<number>`row_number() over (partition by ${quotes.accountId} order by ${quotes.createdAt} desc, ${quotes.id} desc)`.as(
        "rank"
      ),
      total: sql<number>`count(*) over (partition by ${quotes.accountId})`.as(
        "total"
      ),
    })
    .from(quotes)
    .where(scope.where(quotes, inArray(quotes.accountId, ids)))
    .as("ranked")
  const rows = await scope.db
    .select()
    .from(ranked)
    .where(sql`${ranked.rank} <= ${IN_USE_EXAMPLE_LIMIT}`)
    .orderBy(asc(ranked.rank))
  for (const row of rows) {
    const used = usage.get(row.accountId)!
    used.counts.quotes = Number(row.total)
    used.examples.push(row.name)
  }
  return usage
}

/** Throws the structured "in use" CONFLICT for the first referenced Account. */
async function assertDeletable(
  scope: OrganizationScope,
  rows: { id: string; name: string }[]
) {
  const usage = await accountUsage(
    scope,
    rows.map((r) => r.id)
  )
  for (const row of rows) {
    const used = usage.get(row.id)
    if (used && Object.values(used.counts).some((n) => n > 0)) {
      throw inUseError({
        entity: "account",
        name: row.name,
        counts: used.counts,
        examples: used.examples,
        suggestion: "archive",
      })
    }
  }
}

const primaryContacts = schema.contacts

export const accountRouter = createTRPCRouter({
  /**
   * One page of Accounts, by name. `search` matches name, industry and
   * website; `type` and `industry` match exactly; `status` defaults to the
   * unarchived Accounts.
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
      const where = ctx.scope.where(
        accounts,
        input.search
          ? or(
              ilike(accounts.name, containsPattern(input.search)),
              ilike(accounts.industry, containsPattern(input.search)),
              ilike(accounts.website, containsPattern(input.search))
            )
          : undefined,
        input.type ? eq(accounts.type, input.type) : undefined,
        input.industry ? eq(accounts.industry, input.industry) : undefined,
        input.status === "all"
          ? undefined
          : eq(accounts.archived, input.status === "archived")
      )
      const contactCount = ctx.scope.db
        .select({ n: count() })
        .from(contacts)
        .where(ctx.scope.where(contacts, eq(contacts.accountId, accounts.id)))
      const [rows, [total]] = await Promise.all([
        ctx.scope.db
          .select({
            id: accounts.id,
            name: accounts.name,
            type: accounts.type,
            industry: accounts.industry,
            website: accounts.website,
            phone: accounts.phone,
            billingCity: accounts.billingCity,
            billingState: accounts.billingState,
            billingCountry: accounts.billingCountry,
            archived: accounts.archived,
            primaryContact: {
              id: primaryContacts.id,
              name: primaryContacts.name,
              email: primaryContacts.email,
            },
            contactCount: sql<number>`(${contactCount})::int`,
          })
          .from(accounts)
          .leftJoin(
            primaryContacts,
            and(
              eq(primaryContacts.organizationId, accounts.organizationId),
              eq(primaryContacts.accountId, accounts.id),
              eq(primaryContacts.isPrimary, true)
            )
          )
          .where(where)
          .orderBy(asc(sql`lower(${accounts.name})`), asc(accounts.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        ctx.scope.db.select({ n: count() }).from(accounts).where(where),
      ])
      return {
        rows: rows.map((r) => ({
          ...r,
          primaryContact: r.primaryContact?.id ? r.primaryContact : null,
        })),
        total: total?.n ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      }
    }),

  /** The distinct types and industries in use, for the list filters. */
  filterOptions: organizationProcedure.query(async ({ ctx }) => {
    const distinct = async (
      column: typeof accounts.type | typeof accounts.industry
    ) => {
      const rows = await ctx.scope.db
        .selectDistinct({ value: column })
        .from(accounts)
        .where(ctx.scope.where(accounts, isNotNull(column)))
        .orderBy(asc(column))
      return rows.map((r) => r.value!)
    }
    const [types, industries] = await Promise.all([
      distinct(accounts.type),
      distinct(accounts.industry),
    ])
    return { types, industries }
  }),

  /**
   * Unarchived Accounts for a picker (e.g. a Quote's Account), by name.
   * `includeId` also returns that Account even when archived, so a form can
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
          id: accounts.id,
          name: accounts.name,
          archived: accounts.archived,
        })
        .from(accounts)
        .where(
          ctx.scope.where(
            accounts,
            or(
              and(
                eq(accounts.archived, false),
                input.search
                  ? ilike(accounts.name, containsPattern(input.search))
                  : undefined
              ),
              input.includeId ? eq(accounts.id, input.includeId) : undefined
            )
          )
        )
        .orderBy(asc(sql`lower(${accounts.name})`))
        .limit(input.limit)
      return rows
    }),

  /** One Account with its Contacts (primary first, then by name). */
  byId: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const account = await ctx.scope.findById(accounts, input.id)
      if (!account) throw notFound("Account")
      const accountContacts = await ctx.scope.findMany(contacts, {
        where: eq(contacts.accountId, account.id),
        orderBy: [
          desc(contacts.isPrimary),
          asc(sql`lower(${contacts.name})`),
          asc(contacts.id),
        ],
      })
      return { ...account, contacts: accountContacts }
    }),

  /** Creates an Account. CONFLICT when the name is taken. */
  create: organizationProcedure
    .input(z.object({ name: requiredText(200), ...accountFields }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        await assertNameFree(scope, input.name)
        return withNameGuard(input.name, () =>
          scope.insert(accounts, stripUndefined(input))
        )
      })
    ),

  /** Edits an Account's details. Omitted fields keep their value. */
  update: organizationProcedure
    .input(
      z.object({
        id: z.uuid(),
        name: requiredText(200).optional(),
        ...accountFields,
      })
    )
    .mutation(({ ctx, input: { id, ...changes } }) =>
      ctx.scope.transaction(async (scope) => {
        if (!(await scope.findById(accounts, id))) throw notFound("Account")
        if (changes.name) await assertNameFree(scope, changes.name, id)
        const updated = await withNameGuard(changes.name ?? "", () =>
          scope.update(accounts, id, stripUndefined(changes))
        )
        if (!updated) throw notFound("Account")
        return updated
      })
    ),

  /** Archives an Account: kept with its Quotes, hidden from pickers. */
  archive: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.scope.update(accounts, input.id, {
        archived: true,
      })
      if (!updated) throw notFound("Account")
      return updated
    }),

  /** Brings an archived Account back into pickers. */
  unarchive: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.scope.update(accounts, input.id, {
        archived: false,
      })
      if (!updated) throw notFound("Account")
      return updated
    }),

  /**
   * Deletes an Account and its Contacts. CONFLICT (`data.inUse`) when Quotes
   * use it — archive it instead.
   */
  delete: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const account = await scope.findById(accounts, input.id)
        if (!account) throw notFound("Account")
        await assertDeletable(scope, [account])
        await scope.delete(accounts, account.id)
        return { id: account.id }
      })
    ),

  /**
   * Deletes several Accounts, all or none: NOT_FOUND if any id isn't this
   * Organization's, CONFLICT (`data.inUse`) if any is used by Quotes.
   */
  deleteMany: organizationProcedure
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(100) }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const ids = [...new Set(input.ids)]
        const rows = await scope.findMany(accounts, {
          where: inArray(accounts.id, ids),
          orderBy: [asc(accounts.name)],
        })
        if (rows.length !== ids.length) throw notFound("Account")
        await assertDeletable(scope, rows)
        await scope.db
          .delete(accounts)
          .where(scope.where(accounts, inArray(accounts.id, ids)))
        return { ids }
      })
    ),
})
