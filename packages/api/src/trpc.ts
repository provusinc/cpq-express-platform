/**
 * tRPC setup: context, transformer, error shape and procedure tiers.
 *
 * Procedure tiers (build new procedures on the narrowest tier that fits):
 * - publicProcedure        — anyone.
 * - authedProcedure        — signed-in User: `ctx.session`, `ctx.user`.
 *                            Otherwise UNAUTHORIZED.
 * - organizationProcedure  — authed, plus a Membership in the request's
 *                            Organization (slug from the
 *                            `x-organization-slug` header, set by the proxy
 *                            from the subdomain): `ctx.organization`,
 *                            `ctx.membership` and `ctx.scope`, the
 *                            Organization-scoped data access. All business
 *                            data goes through `ctx.scope`. `ctx.actor` is
 *                            the Membership as the domain policy's `Actor`.
 * - permittedProcedure(a)  — organization tier where the domain policy allows
 *                            Organization action `a` (`can(actor, a)`), e.g.
 *                            `permittedProcedure("members.manage")`.
 * - adminProcedure         — organization tier with Role = Admin.
 * - platformProcedure      — authed, and the User is a Platform Admin. Grants
 *                            no Organization access by itself.
 *
 * Refusals are uniform so they never reveal what exists elsewhere:
 * - no session                                  → UNAUTHORIZED
 * - no slug header                              → BAD_REQUEST
 * - unknown Organization, or no Membership in it → NOT_FOUND (identical)
 * - a record id from another Organization       → NOT_FOUND (the scope finds
 *                                                 nothing; throw NOT_FOUND)
 * - a Member lacking the Role / Approver right,
 *   or a non–Platform Admin on the platform tier → FORBIDDEN
 */
import { initTRPC, TRPCError } from "@trpc/server"
import superjson from "superjson"
import { z, ZodError } from "zod"

import { getSessionFromHeaders } from "@workspace/auth"
import type { Session } from "@workspace/auth"
import { authEnv } from "@workspace/auth/env"
import { createSmtpMailer } from "@workspace/auth/mailer"
import type { Mailer } from "@workspace/auth/mailer"
import { and, eq, organizationScope, schema } from "@workspace/db"
import type { Db } from "@workspace/db"
import { can } from "@workspace/domain/policy"
import type { Actor, OrganizationAction } from "@workspace/domain/policy"

import { ORGANIZATION_SLUG_HEADER } from "./headers"

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
  /** Outgoing email. Defaults to SMTP; the test harness passes an in-memory one. */
  mailer?: Mailer
  /**
   * Public base URL of the `app.` surface, for links in emails (Invitation
   * accept links). Defaults to APP_URL.
   */
  appUrl?: string
}

// Process-wide defaults, created on first use.
let smtpMailer: Mailer | undefined
let defaultAppUrl: string | undefined

/**
 * Builds the per-request context. The Organization is resolved lazily by
 * `organizationProcedure`, so non-Organization calls cost nothing extra.
 */
export async function createTRPCContext(opts: CreateContextOptions) {
  const session =
    opts.session !== undefined
      ? opts.session
      : await getSessionFromHeaders(opts.db, opts.headers)
  return {
    db: opts.db,
    headers: opts.headers,
    session,
    mailer: opts.mailer ?? (smtpMailer ??= createSmtpMailer()),
    appUrl: opts.appUrl ?? (defaultAppUrl ??= authEnv().APP_URL),
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

/**
 * The Organization and Membership for `slug` and `userId`, or null when the
 * Organization doesn't exist or the User holds no Membership there.
 */
async function findMembership(db: Db, slug: string, userId: string) {
  const [row] = await db
    .select({
      organization: {
        id: schema.organizations.id,
        slug: schema.organizations.slug,
        name: schema.organizations.name,
        currencyCode: schema.organizations.currencyCode,
      },
      membership: {
        id: schema.memberships.id,
        role: schema.memberships.role,
        isApprover: schema.memberships.isApprover,
      },
    })
    .from(schema.memberships)
    .innerJoin(
      schema.organizations,
      eq(schema.organizations.id, schema.memberships.organizationId)
    )
    .where(
      and(
        eq(schema.organizations.slug, slug),
        eq(schema.memberships.userId, userId)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * Member of the request's Organization. Adds `ctx.organization`,
 * `ctx.membership` and `ctx.scope` (an `OrganizationScope` bound to it).
 */
export const organizationProcedure = authedProcedure.use(
  async ({ ctx, next }) => {
    const slug = ctx.headers.get(ORGANIZATION_SLUG_HEADER)
    if (!slug) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This request isn't for an Organization.",
      })
    }
    const found = await findMembership(ctx.db, slug, ctx.user.id)
    if (!found) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Organization not found.",
      })
    }
    const actor: Actor = {
      userId: ctx.user.id,
      role: found.membership.role,
      isApprover: found.membership.isApprover,
    }
    return next({
      ctx: {
        organization: found.organization,
        membership: found.membership,
        actor,
        scope: organizationScope(ctx.db, found.organization.id),
      },
    })
  }
)

/**
 * Member whom the domain policy allows Organization action `action`
 * (`can(ctx.actor, action)`); FORBIDDEN with the policy's message otherwise.
 */
export function permittedProcedure(action: OrganizationAction) {
  return organizationProcedure.use(({ ctx, next }) => {
    const decision = can(ctx.actor, action)
    if (!decision.allowed) {
      throw new TRPCError({ code: "FORBIDDEN", message: decision.message })
    }
    return next()
  })
}

/** Admin of the request's Organization (Role = Admin). */
export const adminProcedure = organizationProcedure.use(({ ctx, next }) => {
  if (ctx.membership.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only Admins can do this.",
    })
  }
  return next()
})

/** Platform Admin (Provus staff). No Organization is resolved. */
export const platformProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.user.isPlatformAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only Platform Admins can do this.",
    })
  }
  return next()
})
