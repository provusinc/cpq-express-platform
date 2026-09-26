import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { asc, eq, schema, sql } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import {
  CATALOG_TYPE_COLOUR_COUNT,
  checkBillingUnitRemoval,
  checkCatalogType,
  freeCatalogTypeColours,
} from "@workspace/domain/catalog"
import type {
  CatalogTypeCheck,
  CatalogTypeIssueReason,
} from "@workspace/domain/catalog"
import { BILLING_UNITS } from "@workspace/domain/enums"
import type { BillingUnit } from "@workspace/domain/enums"

import { listCatalogTypes, loadCatalogType } from "../catalog-types"
import { IN_USE_EXAMPLE_LIMIT, inUseError, notFound } from "../errors"
import {
  createTRPCRouter,
  organizationProcedure,
  permittedProcedure,
} from "../trpc"

const { catalogItems, catalogTypes, organizations } = schema

type CatalogType = typeof catalogTypes.$inferSelect

const manageSettings = permittedProcedure("settings.manage")

/** How many of a type's Catalog Items (active or not) use each Billing Unit. */
type ItemsByUnit = Record<BillingUnit, number>

const noItems = (): ItemsByUnit => ({ each: 0, hour: 0 })

/** Item counts per Catalog Type and Billing Unit, for the whole Organization. */
async function itemUsage(
  scope: OrganizationScope,
  catalogTypeId?: string
): Promise<Map<string, ItemsByUnit>> {
  const rows = await scope.db
    .select({
      catalogTypeId: catalogItems.catalogTypeId,
      billingUnit: catalogItems.billingUnit,
      n: sql<number>`count(*)::int`,
    })
    .from(catalogItems)
    .where(
      catalogTypeId
        ? scope.where(
            catalogItems,
            eq(catalogItems.catalogTypeId, catalogTypeId)
          )
        : scope.where(catalogItems)
    )
    .groupBy(catalogItems.catalogTypeId, catalogItems.billingUnit)
  const usage = new Map<string, ItemsByUnit>()
  for (const row of rows) {
    const counts = usage.get(row.catalogTypeId) ?? noItems()
    counts[row.billingUnit] = row.n
    usage.set(row.catalogTypeId, counts)
  }
  return usage
}

/** A Catalog Type with how many Catalog Items it has (in all, per unit). */
function view(type: CatalogType, usage: Map<string, ItemsByUnit>) {
  const itemsByUnit = usage.get(type.id) ?? noItems()
  return {
    ...type,
    itemCount: BILLING_UNITS.reduce((n, u) => n + itemsByUnit[u], 0),
    itemsByUnit,
  }
}

/**
 * Serialises every Catalog Type command of the Organization (the active cap,
 * distinct colours and unique names are rules across rows), then reads the
 * types in order. `NO KEY UPDATE` on the Organization row doesn't block the
 * `KEY SHARE` locks foreign-key checks take on it.
 */
async function lockTypes(scope: OrganizationScope) {
  await scope.db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, scope.organizationId))
    .for("no key update")
  return listCatalogTypes(scope)
}

const REFUSAL_CODES: Record<CatalogTypeIssueReason, TRPCError["code"]> = {
  blank: "BAD_REQUEST",
  too_long: "BAD_REQUEST",
  no_billing_unit: "BAD_REQUEST",
  invalid_colour: "BAD_REQUEST",
  duplicate_name: "CONFLICT",
  colour_taken: "CONFLICT",
  too_many_active: "PRECONDITION_FAILED",
}

/** The domain's verdict, or its first refusal as a tRPC error. */
function checked(check: CatalogTypeCheck) {
  if (!check.ok) {
    throw new TRPCError({
      code: REFUSAL_CODES[check.reason],
      message: check.message,
    })
  }
  return check.type
}

// Names are checked by the domain; the cap here only bounds the payload.
const nameInput = z.string().max(1000)
const billingUnitsInput = z
  .array(z.enum(BILLING_UNITS))
  .max(BILLING_UNITS.length)
const colourIndexInput = z
  .int()
  .min(0)
  .max(CATALOG_TYPE_COLOUR_COUNT - 1)

/**
 * Catalog Types (glossary: Catalog Type, ADR-0005). Reads for every member:
 * the shell's nav and ⌘K, the catalog pages, the Add Items sheet and every
 * surface that colours or names a line by its type. Settings → Catalog
 * types manages them (`settings.manage`); the rules are the domain's
 * `checkCatalogType` and `checkBillingUnitRemoval`, which the form runs too.
 */
export const catalogTypeRouter = createTRPCRouter({
  /**
   * Every Catalog Type of the Organization, in order (inactive included),
   * each with its Catalog Item count, in all (`itemCount`) and per Billing
   * Unit (`itemsByUnit`).
   */
  list: organizationProcedure.query(async ({ ctx }) => {
    const [types, usage] = await Promise.all([
      listCatalogTypes(ctx.scope),
      itemUsage(ctx.scope),
    ])
    return types.map((type) => view(type, usage))
  }),

  /** One Catalog Type; NOT_FOUND for an unknown or another Organization's. */
  byId: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const type = await loadCatalogType(ctx.scope, input.id)
      return view(type, await itemUsage(ctx.scope, type.id))
    }),

  /**
   * Adds a Catalog Type at the end. `colourIndex` defaults to the first
   * colour no active type uses; `active` defaults to true. Refusals: a name
   * another type has or a colour an active type uses → CONFLICT; a seventh
   * active type → PRECONDITION_FAILED; blank names or no Billing Unit →
   * BAD_REQUEST.
   */
  create: manageSettings
    .input(
      z.object({
        singular: nameInput,
        plural: nameInput,
        billingUnits: billingUnitsInput,
        colourIndex: colourIndexInput.optional(),
        active: z.boolean().default(true),
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const types = await lockTypes(scope)
        const type = checked(
          checkCatalogType(
            {
              ...input,
              colourIndex:
                input.colourIndex ?? freeCatalogTypeColours(types)[0] ?? 0,
            },
            types
          )
        )
        const sequence = Math.max(-1, ...types.map((t) => t.sequence)) + 1
        const row = await scope.insert(catalogTypes, { ...type, sequence })
        return view(row, new Map())
      })
    ),

  /**
   * Changes a Catalog Type's names, Billing Units, colour or active switch
   * (only the given fields). The result is checked as a whole against the
   * other types, as on create. Removing a Billing Unit that some of its
   * Catalog Items use → PRECONDITION_FAILED naming how many. Deactivating
   * keeps its items (and the Line Items made from them); it just leaves the
   * nav, ⌘K and the Add Items sheet, and its page turns read-only.
   */
  update: manageSettings
    .input(
      z.object({
        id: z.uuid(),
        singular: nameInput.optional(),
        plural: nameInput.optional(),
        billingUnits: billingUnitsInput.optional(),
        colourIndex: colourIndexInput.optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const types = await lockTypes(scope)
        const current = types.find((t) => t.id === input.id)
        if (!current) throw notFound("Catalog Type")
        const type = checked(
          checkCatalogType(
            {
              singular: input.singular ?? current.singular,
              plural: input.plural ?? current.plural,
              billingUnits: input.billingUnits ?? current.billingUnits,
              colourIndex: input.colourIndex ?? current.colourIndex,
              active: input.active ?? current.active,
            },
            types.filter((t) => t.id !== current.id)
          )
        )
        const usage = await itemUsage(scope, current.id)
        const removal = checkBillingUnitRemoval({
          type,
          from: current.billingUnits,
          to: type.billingUnits,
          itemsByUnit: usage.get(current.id) ?? noItems(),
        })
        if (!removal.ok) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: removal.message,
          })
        }
        const row = await scope.update(catalogTypes, current.id, {
          ...type,
          updatedAt: new Date(),
        })
        if (!row) throw notFound("Catalog Type")
        return view(row, usage)
      })
    ),

  /**
   * Puts the Catalog Types in the given order (the nav, ⌘K, the Add Items
   * tabs and the Mix breakdown follow it). `ids` must be every type of the
   * Organization exactly once: an unknown id → NOT_FOUND, a missing or
   * repeated one → BAD_REQUEST.
   */
  reorder: manageSettings
    .input(z.object({ ids: z.array(z.uuid()).min(1).max(100) }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const types = await lockTypes(scope)
        if (!input.ids.every((id) => types.some((t) => t.id === id))) {
          throw notFound("Catalog Type")
        }
        if (
          new Set(input.ids).size !== input.ids.length ||
          input.ids.length !== types.length
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "List every Catalog Type exactly once.",
          })
        }
        for (const [sequence, id] of input.ids.entries()) {
          const type = types.find((t) => t.id === id)!
          if (type.sequence !== sequence) {
            await scope.update(catalogTypes, id, {
              sequence,
              updatedAt: new Date(),
            })
          }
        }
        return input.ids
      })
    ),

  /**
   * Deletes a Catalog Type that has no Catalog Items (active or not);
   * otherwise CONFLICT (`inUseError`, suggesting deactivate). The FK from
   * `catalog_items` (RESTRICT) backs it.
   */
  delete: manageSettings
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const types = await lockTypes(scope)
        const type = types.find((t) => t.id === input.id)
        if (!type) throw notFound("Catalog Type")
        const items = await scope.db
          .select({
            name: catalogItems.name,
            total: sql<number>`count(*) over ()`.mapWith(Number),
          })
          .from(catalogItems)
          .where(
            scope.where(catalogItems, eq(catalogItems.catalogTypeId, type.id))
          )
          .orderBy(asc(sql`lower(${catalogItems.name})`))
          .limit(IN_USE_EXAMPLE_LIMIT)
        if (items.length > 0) {
          throw inUseError({
            entity: "catalog_type",
            name: type.plural,
            counts: { catalogItems: items[0]!.total },
            examples: items.map((i) => i.name),
            suggestion: "deactivate",
          })
        }
        await scope.delete(catalogTypes, type.id)
        return { id: type.id }
      })
    ),
})
