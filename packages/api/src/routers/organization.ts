import { asc, eq, schema } from "@workspace/db"

import {
  authedProcedure,
  createTRPCRouter,
  organizationProcedure,
} from "../trpc"

export const organizationRouter = createTRPCRouter({
  /**
   * The request's Organization and the caller's Membership in it. NOT_FOUND
   * when the Organization doesn't exist or the caller isn't a member.
   */
  current: organizationProcedure.query(({ ctx }) => ({
    organization: ctx.organization,
    membership: ctx.membership,
  })),

  /**
   * Every Organization the caller holds a Membership in, by name — for the
   * Organization picker and switcher. Works on any host.
   */
  listMine: authedProcedure.query(({ ctx }) =>
    ctx.db
      .select({
        organization: {
          id: schema.organizations.id,
          slug: schema.organizations.slug,
          name: schema.organizations.name,
        },
        role: schema.memberships.role,
        isApprover: schema.memberships.isApprover,
      })
      .from(schema.memberships)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.memberships.organizationId)
      )
      .where(eq(schema.memberships.userId, ctx.user.id))
      .orderBy(asc(schema.organizations.name), asc(schema.organizations.slug))
  ),
})
