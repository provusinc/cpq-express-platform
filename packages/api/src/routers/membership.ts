import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { asc, eq, schema } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"

import { createTRPCRouter, organizationProcedure } from "../trpc"

const { memberships, users } = schema

/** Memberships of the scope's Organization with their User, optionally narrowed. */
function selectMemberships(scope: OrganizationScope) {
  return scope.db
    .select({
      id: memberships.id,
      role: memberships.role,
      isApprover: memberships.isApprover,
      createdAt: memberships.createdAt,
      user: { id: users.id, name: users.name, email: users.email },
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .$dynamic()
}

export const membershipRouter = createTRPCRouter({
  /** The Organization's Memberships, by name then email. */
  list: organizationProcedure.query(({ ctx }) =>
    selectMemberships(ctx.scope)
      .where(ctx.scope.where(memberships))
      .orderBy(asc(users.name), asc(users.email))
  ),

  /** One Membership of this Organization; NOT_FOUND for any other id. */
  byId: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const [membership] = await selectMemberships(ctx.scope)
        .where(ctx.scope.where(memberships, eq(memberships.id, input.id)))
        .limit(1)
      if (!membership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Membership not found.",
        })
      }
      return membership
    }),
})
