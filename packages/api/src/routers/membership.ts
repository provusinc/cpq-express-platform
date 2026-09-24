import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { asc, eq, schema } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import { checkMembershipChange } from "@workspace/domain/members"
import type { MembershipChange } from "@workspace/domain/members"

import { roleInput } from "../inputs"
import {
  createTRPCRouter,
  organizationProcedure,
  permittedProcedure,
} from "../trpc"

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

/**
 * Loads a Membership for a change that might remove an Admin, checking the
 * last-Admin guard. The Organization's Admin rows are locked first, so two
 * concurrent demotions can't both pass the check and leave no Admin.
 */
async function guardedMembership(
  scope: OrganizationScope,
  id: string,
  change: MembershipChange
) {
  const admins = await scope.db
    .select({ id: memberships.id })
    .from(memberships)
    .where(scope.where(memberships, eq(memberships.role, "admin")))
    .for("update")
  const membership = await scope.findById(memberships, id)
  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Membership not found." })
  }
  const check = checkMembershipChange(membership, change, admins.length)
  if (!check.ok) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: check.message })
  }
  return membership
}

const manageMembers = permittedProcedure("members.manage")

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

  /**
   * Gives a member another Role. PRECONDITION_FAILED when it would leave the
   * Organization without an Admin (including an Admin demoting themselves).
   */
  changeRole: manageMembers
    .input(z.object({ id: z.uuid(), role: roleInput }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        await guardedMembership(scope, input.id, {
          kind: "changeRole",
          role: input.role,
        })
        const updated = await scope.update(memberships, input.id, {
          role: input.role,
        })
        return { id: updated!.id, role: updated!.role }
      })
    ),

  /** Grants or removes the Approver right, independently of Role. */
  setApprover: manageMembers
    .input(z.object({ id: z.uuid(), isApprover: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.scope.update(memberships, input.id, {
        isApprover: input.isApprover,
      })
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Membership not found.",
        })
      }
      return { id: updated.id, isApprover: updated.isApprover }
    }),

  /**
   * Removes a member: deletes the Membership only. The User keeps their
   * identity (and other Memberships), and nothing they own is deleted or
   * reassigned — they stay the Quote Owner of their Quotes. The last Admin
   * can't be removed.
   */
  remove: manageMembers
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        await guardedMembership(scope, input.id, { kind: "remove" })
        const removed = await scope.delete(memberships, input.id)
        return { id: removed!.id }
      })
    ),
})
