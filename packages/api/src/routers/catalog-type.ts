import { z } from "zod"

import { listCatalogTypes, loadCatalogType } from "../catalog-types"
import { createTRPCRouter, organizationProcedure } from "../trpc"

/**
 * Catalog Types (glossary: Catalog Type, ADR-0005). Reads for every member:
 * the shell's nav and ⌘K, the catalog pages, the Add Items sheet and every
 * surface that colours or names a line by its type. Managing them is
 * Settings (#35).
 */
export const catalogTypeRouter = createTRPCRouter({
  /** Every Catalog Type of the Organization, in order (inactive included). */
  list: organizationProcedure.query(({ ctx }) => listCatalogTypes(ctx.scope)),

  /** One Catalog Type; NOT_FOUND for an unknown or another Organization's. */
  byId: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(({ ctx, input }) => loadCatalogType(ctx.scope, input.id)),
})
