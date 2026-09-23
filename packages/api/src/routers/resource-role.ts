import { TRPCError } from "@trpc/server"
import { z } from "zod"

import {
  asc,
  count,
  eq,
  gte,
  ilike,
  isNotNull,
  lte,
  or,
  schema,
  sql,
} from "@workspace/db"
import { Decimal } from "@workspace/domain/money"

import {
  importRowsInput,
  parseResourceRoleRow,
  summarize,
} from "../catalog-import"
import { propagateCost } from "../cost-propagation"
import { inUseError, notFound } from "../errors"
import { lineItemSourceUsage } from "../line-items"
import {
  activeFilter,
  containsPattern,
  money,
  optionalText,
  paging,
  requiredText,
  stripUndefined,
} from "../inputs"
import {
  createTRPCRouter,
  organizationProcedure,
  permittedProcedure,
} from "../trpc"

const { lineItems, resourceRoles } = schema

/** Only Admins manage Resource Roles (domain policy "catalog.manage"). */
const manageProcedure = permittedProcedure("catalog.manage")

const importInput = z.object({ rows: importRowsInput })

/** Rows inserted per statement during an import. */
const IMPORT_CHUNK = 500

const roleFields = {
  name: requiredText(200),
  description: optionalText(2000),
  billRate: money,
  costRate: money,
  locationCountry: optionalText(100),
  locationState: optionalText(100),
  locationCity: optionalText(100),
}

export const resourceRoleRouter = createTRPCRouter({
  /**
   * One page of Resource Roles, by name. Filters: `search` (name,
   * description), `status`, bill-rate range (inclusive) and location
   * (country, state, city — each an exact match).
   */
  list: organizationProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        status: activeFilter,
        minRate: money.optional(),
        maxRate: money.optional(),
        country: z.string().optional(),
        state: z.string().optional(),
        city: z.string().optional(),
        ...paging,
      })
    )
    .query(async ({ ctx, input }) => {
      const where = ctx.scope.where(
        resourceRoles,
        input.search
          ? or(
              ilike(resourceRoles.name, containsPattern(input.search)),
              ilike(resourceRoles.description, containsPattern(input.search))
            )
          : undefined,
        input.status === "all"
          ? undefined
          : eq(resourceRoles.active, input.status === "active"),
        input.minRate ? gte(resourceRoles.billRate, input.minRate) : undefined,
        input.maxRate ? lte(resourceRoles.billRate, input.maxRate) : undefined,
        input.country
          ? eq(resourceRoles.locationCountry, input.country)
          : undefined,
        input.state ? eq(resourceRoles.locationState, input.state) : undefined,
        input.city ? eq(resourceRoles.locationCity, input.city) : undefined
      )
      const [rows, [total]] = await Promise.all([
        ctx.scope.db
          .select()
          .from(resourceRoles)
          .where(where)
          .orderBy(
            asc(sql`lower(${resourceRoles.name})`),
            asc(resourceRoles.id)
          )
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        ctx.scope.db.select({ n: count() }).from(resourceRoles).where(where),
      ])
      return {
        rows,
        total: total?.n ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      }
    }),

  /**
   * The Add Items sheet's list: active Resource Roles by name, in pages for
   * infinite scroll (`cursor` = offset of the next page, `nextCursor` null
   * at the end). Filters: `search` (name, description) and location
   * (country, state, city — each an exact match).
   */
  listForPicker: organizationProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).optional(),
        country: z.string().optional(),
        state: z.string().optional(),
        city: z.string().optional(),
        cursor: z.number().int().min(0).nullish(),
        limit: z.number().int().min(1).max(100).default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const offset = input.cursor ?? 0
      const rows = await ctx.scope.db
        .select({
          id: resourceRoles.id,
          name: resourceRoles.name,
          description: resourceRoles.description,
          billRate: resourceRoles.billRate,
          locationCountry: resourceRoles.locationCountry,
          locationState: resourceRoles.locationState,
          locationCity: resourceRoles.locationCity,
        })
        .from(resourceRoles)
        .where(
          ctx.scope.where(
            resourceRoles,
            eq(resourceRoles.active, true),
            input.search
              ? or(
                  ilike(resourceRoles.name, containsPattern(input.search)),
                  ilike(
                    resourceRoles.description,
                    containsPattern(input.search)
                  )
                )
              : undefined,
            input.country
              ? eq(resourceRoles.locationCountry, input.country)
              : undefined,
            input.state
              ? eq(resourceRoles.locationState, input.state)
              : undefined,
            input.city ? eq(resourceRoles.locationCity, input.city) : undefined
          )
        )
        .orderBy(asc(sql`lower(${resourceRoles.name})`), asc(resourceRoles.id))
        .limit(input.limit + 1)
        .offset(offset)
      const more = rows.length > input.limit
      return {
        rows: more ? rows.slice(0, input.limit) : rows,
        nextCursor: more ? offset + input.limit : null,
      }
    }),

  /** The distinct locations in use, for the location filters. */
  locations: organizationProcedure.query(async ({ ctx }) => {
    return ctx.scope.db
      .selectDistinct({
        country: resourceRoles.locationCountry,
        state: resourceRoles.locationState,
        city: resourceRoles.locationCity,
      })
      .from(resourceRoles)
      .where(
        ctx.scope.where(
          resourceRoles,
          or(
            isNotNull(resourceRoles.locationCountry),
            isNotNull(resourceRoles.locationState),
            isNotNull(resourceRoles.locationCity)
          )
        )
      )
      .orderBy(
        asc(resourceRoles.locationCountry),
        asc(resourceRoles.locationState),
        asc(resourceRoles.locationCity)
      )
  }),

  /** One Resource Role. */
  byId: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const role = await ctx.scope.findById(resourceRoles, input.id)
      if (!role) throw notFound("Resource Role")
      return role
    }),

  /** Creates a Resource Role (always billed hourly). Admins only. */
  create: manageProcedure
    .input(z.object({ ...roleFields, active: z.boolean().default(true) }))
    .mutation(({ ctx, input }) =>
      ctx.scope.insert(resourceRoles, stripUndefined(input))
    ),

  /**
   * Edits a Resource Role; omitted fields keep their value. Bill rate
   * changes never touch existing Quotes. A cost rate change is propagated
   * to Draft Quotes in the same transaction (Cost Propagation: Base Rate
   * and unit cost of their lines, repriced, logged); `costPropagation`
   * counts what it rewrote. Admins only.
   */
  update: manageProcedure
    .input(z.object({ id: z.uuid(), ...z.object(roleFields).partial().shape }))
    .mutation(({ ctx, input: { id, ...changes } }) =>
      ctx.scope.transaction(async (scope) => {
        const before = await scope.findById(resourceRoles, id)
        if (!before) throw notFound("Resource Role")
        const role = (await scope.update(
          resourceRoles,
          id,
          stripUndefined(changes)
        ))!
        const costPropagation = new Decimal(before.costRate).equals(
          role.costRate
        )
          ? { quotes: 0, lineItems: 0 }
          : await propagateCost(scope, {
              source: { kind: "resource_role", id: role.id, name: role.name },
              cost: role.costRate,
              actorId: ctx.user.id,
            })
        return { ...role, costPropagation }
      })
    ),

  /** Stops the role being added to Quotes; existing Quotes keep it. Admins only. */
  deactivate: manageProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const role = await ctx.scope.update(resourceRoles, input.id, {
        active: false,
      })
      if (!role) throw notFound("Resource Role")
      return role
    }),

  /** Makes a deactivated role available again. Admins only. */
  reactivate: manageProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const role = await ctx.scope.update(resourceRoles, input.id, {
        active: true,
      })
      if (!role) throw notFound("Resource Role")
      return role
    }),

  /**
   * Deletes a Resource Role that has never been used. CONFLICT
   * (`data.inUse`, suggesting deactivation) once Quotes use it. Admins only.
   */
  delete: manageProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const role = await scope.findById(resourceRoles, input.id)
        if (!role) throw notFound("Resource Role")
        const usage = await lineItemSourceUsage(
          scope,
          lineItems.resourceRoleId,
          role.id
        )
        if (Object.values(usage.counts).some((n) => n > 0)) {
          throw inUseError({
            entity: "resource_role",
            name: role.name,
            ...usage,
            suggestion: "deactivate",
          })
        }
        await scope.delete(resourceRoles, role.id)
        return { id: role.id }
      })
    ),

  /**
   * CSV import preview: parses every row with the import rules and returns
   * per-row errors (nothing is saved). Admins only.
   */
  validateImport: manageProcedure
    .input(importInput)
    .mutation(({ input }) =>
      summarize(input.rows.map((row, i) => parseResourceRoleRow(row, i)))
    ),

  /**
   * Imports Resource Roles from CSV rows, all or nothing: re-validated, and
   * inserted in one transaction only when every row is valid. Admins only.
   */
  import: manageProcedure.input(importInput).mutation(({ ctx, input }) => {
    const results = input.rows.map((row, i) => parseResourceRoleRow(row, i))
    const { errorCount } = summarize(results)
    if (errorCount > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${errorCount} of ${results.length} rows have errors, so nothing was imported. Fix them and upload the file again.`,
      })
    }
    const values = results.map((r) => r.values!)
    return ctx.scope.transaction(async (scope) => {
      for (let i = 0; i < values.length; i += IMPORT_CHUNK) {
        await scope.insertMany(resourceRoles, values.slice(i, i + IMPORT_CHUNK))
      }
      return { imported: values.length }
    })
  }),
})
