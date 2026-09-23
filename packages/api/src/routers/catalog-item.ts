import { TRPCError } from "@trpc/server"
import { z } from "zod"

import {
  arrayContains,
  asc,
  count,
  eq,
  gte,
  ilike,
  lte,
  or,
  schema,
  sql,
} from "@workspace/db"
import { BILLING_UNITS, CATALOG_ITEM_KINDS } from "@workspace/domain/enums"

import {
  importRowsInput,
  parseCatalogItemRow,
  summarize,
} from "../catalog-import"
import { inUseError, notFound } from "../errors"
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

const { catalogItems } = schema

/** Only Admins manage the catalog (domain policy "catalog.manage"). */
const manageProcedure = permittedProcedure("catalog.manage")

/** Tags: trimmed, lower-cased, de-duplicated, blanks dropped. */
export const tagsInput = z
  .array(z.string().max(50))
  .max(30)
  .transform((tags) => normalizeTags(tags))

export function normalizeTags(tags: readonly string[]) {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
}

export const PRODUCT_BILLED_EACH =
  "A Product is always billed Each; only Add-ons can be billed by the Hour."

/** CatalogItem fields a user edits (kind is fixed at creation). */
const itemFields = {
  name: requiredText(200),
  description: optionalText(2000),
  price: money,
  cost: money,
  billingUnit: z.enum(BILLING_UNITS),
  tags: tagsInput,
}

const kindFilter = z.enum(CATALOG_ITEM_KINDS)

const importInput = z.object({
  rows: importRowsInput,
  /** Fills a blank Type: the page the import started from. */
  defaultKind: kindFilter.optional(),
})

/** Rows inserted per statement during an import. */
const IMPORT_CHUNK = 500

/**
 * What references each Catalog Item and would block its deletion. Line
 * Items don't exist yet; the Line Items ticket counts them here (and
 * references Catalog Items with ON DELETE RESTRICT).
 */
async function catalogItemUsage(itemId: string) {
  void itemId // nothing references it yet
  return { counts: {} as { quotes?: number; lineItems?: number }, examples: [] }
}

export const catalogItemRouter = createTRPCRouter({
  /**
   * One page of Products or Add-ons, by name. Filters: `search` (name,
   * description), `billingUnit`, `status`, price range (inclusive) and
   * `tags` (items carrying all of them).
   */
  list: organizationProcedure
    .input(
      z.object({
        kind: kindFilter,
        search: z.string().trim().max(200).optional(),
        billingUnit: z.enum(BILLING_UNITS).optional(),
        status: activeFilter,
        minPrice: money.optional(),
        maxPrice: money.optional(),
        tags: tagsInput.optional(),
        ...paging,
      })
    )
    .query(async ({ ctx, input }) => {
      const where = ctx.scope.where(
        catalogItems,
        eq(catalogItems.kind, input.kind),
        input.search
          ? or(
              ilike(catalogItems.name, containsPattern(input.search)),
              ilike(catalogItems.description, containsPattern(input.search))
            )
          : undefined,
        input.billingUnit
          ? eq(catalogItems.billingUnit, input.billingUnit)
          : undefined,
        input.status === "all"
          ? undefined
          : eq(catalogItems.active, input.status === "active"),
        input.minPrice ? gte(catalogItems.price, input.minPrice) : undefined,
        input.maxPrice ? lte(catalogItems.price, input.maxPrice) : undefined,
        input.tags?.length
          ? arrayContains(catalogItems.tags, input.tags)
          : undefined
      )
      const [rows, [total]] = await Promise.all([
        ctx.scope.db
          .select()
          .from(catalogItems)
          .where(where)
          .orderBy(asc(sql`lower(${catalogItems.name})`), asc(catalogItems.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        ctx.scope.db.select({ n: count() }).from(catalogItems).where(where),
      ])
      return {
        rows,
        total: total?.n ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      }
    }),

  /** The tags in use on this kind of Catalog Item, alphabetically. */
  tags: organizationProcedure
    .input(z.object({ kind: kindFilter }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.scope.db
        .selectDistinct({ tag: sql<string>`unnest(${catalogItems.tags})` })
        .from(catalogItems)
        .where(ctx.scope.where(catalogItems, eq(catalogItems.kind, input.kind)))
        .orderBy(sql`1`)
      return rows.map((r) => r.tag)
    }),

  /** One Catalog Item. */
  byId: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const item = await ctx.scope.findById(catalogItems, input.id)
      if (!item) throw notFound("Catalog Item")
      return item
    }),

  /** Creates a Product (always Each) or an Add-on (Each or Hour). Admins only. */
  create: manageProcedure
    .input(
      z
        .object({
          kind: kindFilter,
          ...itemFields,
          billingUnit: itemFields.billingUnit.default("each"),
          tags: itemFields.tags.default([]),
          active: z.boolean().default(true),
        })
        .refine((v) => v.kind !== "product" || v.billingUnit === "each", {
          message: PRODUCT_BILLED_EACH,
          path: ["billingUnit"],
        })
    )
    .mutation(({ ctx, input }) =>
      ctx.scope.insert(catalogItems, stripUndefined(input))
    ),

  /**
   * Edits a Catalog Item; omitted fields keep their value. Price changes
   * never touch existing Quotes. (Cost Propagation to Draft Quotes arrives
   * with Line Items.) Admins only.
   */
  update: manageProcedure
    .input(
      z.object({
        id: z.uuid(),
        ...z.object(itemFields).partial().shape,
      })
    )
    .mutation(({ ctx, input: { id, ...changes } }) =>
      ctx.scope.transaction(async (scope) => {
        const item = await scope.findById(catalogItems, id)
        if (!item) throw notFound("Catalog Item")
        if (item.kind === "product" && changes.billingUnit === "hour") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: PRODUCT_BILLED_EACH,
          })
        }
        return (await scope.update(catalogItems, id, stripUndefined(changes)))!
      })
    ),

  /** Stops the item being added to Quotes; existing Quotes keep it. Admins only. */
  deactivate: manageProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.scope.update(catalogItems, input.id, {
        active: false,
      })
      if (!item) throw notFound("Catalog Item")
      return item
    }),

  /** Makes a deactivated item available again. Admins only. */
  reactivate: manageProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.scope.update(catalogItems, input.id, {
        active: true,
      })
      if (!item) throw notFound("Catalog Item")
      return item
    }),

  /**
   * Deletes a Catalog Item that has never been used. CONFLICT
   * (`data.inUse`, suggesting deactivation) once Quotes use it. Admins only.
   */
  delete: manageProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const item = await scope.findById(catalogItems, input.id)
        if (!item) throw notFound("Catalog Item")
        const usage = await catalogItemUsage(item.id)
        if (Object.values(usage.counts).some((n) => n > 0)) {
          throw inUseError({
            entity: "catalog_item",
            name: item.name,
            ...usage,
            suggestion: "deactivate",
          })
        }
        await scope.delete(catalogItems, item.id)
        return { id: item.id }
      })
    ),

  /**
   * CSV import preview: parses every row with the import rules and returns
   * per-row errors (nothing is saved). Admins only.
   */
  validateImport: manageProcedure
    .input(importInput)
    .mutation(({ input }) =>
      summarize(
        input.rows.map((row, i) =>
          parseCatalogItemRow(row, i, input.defaultKind)
        )
      )
    ),

  /**
   * Imports Products and Add-ons from CSV rows, all or nothing: the rows are
   * re-validated and, if any has an error, nothing is saved (BAD_REQUEST);
   * otherwise every row is inserted in one transaction. Admins only.
   */
  import: manageProcedure.input(importInput).mutation(({ ctx, input }) => {
    const results = input.rows.map((row, i) =>
      parseCatalogItemRow(row, i, input.defaultKind)
    )
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
        await scope.insertMany(catalogItems, values.slice(i, i + IMPORT_CHUNK))
      }
      return { imported: values.length }
    })
  }),
})
