/**
 * tRPC setup: context, transformer, error shape and procedure tiers.
 *
 * Procedure tiers (build new procedures on the narrowest tier that fits):
 * - publicProcedure        — anyone. (this file)
 * - authedProcedure        — signed-in User.                       (#3)
 * - organizationProcedure  — resolves the Organization from the subdomain slug,
 *                            requires a Membership, exposes the Organization,
 *                            Membership and Organization-scoped data access. (#4)
 * - adminProcedure         — Membership Role is Admin.             (#4)
 * - platformProcedure      — User is a Platform Admin.             (#4)
 */
import { initTRPC } from "@trpc/server"
import superjson from "superjson"
import { z, ZodError } from "zod"

import type { Db } from "@workspace/db"

export interface CreateContextOptions {
  /** Request headers (Host → Organization slug, cookies → session). */
  headers: Headers
  /**
   * Database handle. The app passes the process-wide client; the test harness
   * passes a transaction that is rolled back after each test.
   */
  db: Db
}

/** Builds the per-request context. Session and Organization join in #3/#4. */
export function createTRPCContext(opts: CreateContextOptions) {
  return {
    db: opts.db,
    headers: opts.headers,
  }
}

export type TRPCContext = ReturnType<typeof createTRPCContext>

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError:
        error.cause instanceof ZodError ? z.flattenError(error.cause) : null,
    },
  }),
})

export const createCallerFactory = t.createCallerFactory
export const createTRPCRouter = t.router
export const middleware = t.middleware

/** Unauthenticated procedure. */
export const publicProcedure = t.procedure
