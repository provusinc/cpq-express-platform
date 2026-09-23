/**
 * tRPC setup: context, transformer, error shape and procedure tiers.
 *
 * Procedure tiers (build new procedures on the narrowest tier that fits):
 * - publicProcedure        — anyone. (this file)
 * - authedProcedure        — signed-in User; `ctx.session` / `ctx.user` are
 *                            non-null, otherwise UNAUTHORIZED.   (this file)
 * - organizationProcedure  — resolves the Organization from the subdomain slug,
 *                            requires a Membership, exposes the Organization,
 *                            Membership and Organization-scoped data access. (#4)
 * - adminProcedure         — Membership Role is Admin.             (#4)
 * - platformProcedure      — User is a Platform Admin.             (#4)
 */
import { initTRPC, TRPCError } from "@trpc/server"
import superjson from "superjson"
import { z, ZodError } from "zod"

import { getSessionFromHeaders } from "@workspace/auth"
import type { Session } from "@workspace/auth"
import type { Db } from "@workspace/db"

export interface CreateContextOptions {
  /** Request headers (Host → Organization slug, cookies → session). */
  headers: Headers
  /**
   * Database handle. The app passes the process-wide client; the test harness
   * passes a transaction that is rolled back after each test.
   */
  db: Db
  /**
   * Pre-resolved session. When omitted (the app), the session is read from
   * the request's session cookie; the test harness passes it directly.
   */
  session?: Session | null
}

/** Builds the per-request context. The Organization joins in #4. */
export async function createTRPCContext(opts: CreateContextOptions) {
  const session =
    opts.session !== undefined
      ? opts.session
      : await getSessionFromHeaders(opts.db, opts.headers)
  return {
    db: opts.db,
    headers: opts.headers,
    session,
  }
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>

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

/** Signed-in User. Narrows `ctx.session` and adds `ctx.user`. */
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required." })
  }
  return next({ ctx: { session: ctx.session, user: ctx.session.user } })
})
