import { TRPCError } from "@trpc/server"
import { z } from "zod"

import {
  eq,
  hashInvitationToken,
  organizationScope,
  schema,
} from "@workspace/db"
import type { Db } from "@workspace/db"

import { invitationStatus } from "../invitations"
import type { InvitationStatus } from "../invitations"
import { authedProcedure, createTRPCRouter, publicProcedure } from "../trpc"

const { invitations, memberships, organizations } = schema

const tokenInput = z.object({ token: z.string().min(1).max(200) })

/** Why an Invitation can't be accepted, in words for the invitee. */
const UNAVAILABLE: Record<Exclude<InvitationStatus, "pending">, string> = {
  expired: "This Invitation has expired. Ask an Admin to send you a new one.",
  revoked:
    "This Invitation was withdrawn. Ask an Admin if you still need access.",
  accepted: "This Invitation has already been used.",
}

/** An Invitation and its Organization, looked up by the emailed token. */
async function findByToken(db: Db, token: string) {
  // The token is the only key the invitee has, so this lookup spans every
  // Organization; the Organization then comes from the Invitation itself.
  const [row] = await db
    .select({
      invitation: invitations,
      organization: {
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
      },
    })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
    .where(eq(invitations.tokenHash, hashInvitationToken(token)))
    .limit(1)
  return row
}

export const invitationRouter = createTRPCRouter({
  /**
   * What the accept page shows for an emailed link: the Organization, Role,
   * invited email and status. Public (possessing the token is the
   * credential); NOT_FOUND for an unknown or replaced token.
   */
  byToken: publicProcedure.input(tokenInput).query(async ({ ctx, input }) => {
    const found = await findByToken(ctx.db, input.token)
    if (!found) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Invitation not found.",
      })
    }
    const status = invitationStatus(found.invitation)
    return {
      status,
      message: status === "pending" ? null : UNAVAILABLE[status],
      email: found.invitation.email,
      role: found.invitation.role,
      expiresAt: found.invitation.expiresAt,
      organization: {
        slug: found.organization.slug,
        name: found.organization.name,
      },
    }
  }),

  /**
   * Accepts an Invitation as the signed-in User: creates their Membership
   * with the invited Role, marks the Invitation used, and returns the
   * Organization to go to. The User's email must be the invited one
   * (FORBIDDEN otherwise); an expired, revoked or used Invitation is
   * PRECONDITION_FAILED. If the User is somehow already a member, their
   * Membership is kept as it is.
   */
  accept: authedProcedure.input(tokenInput).mutation(({ ctx, input }) =>
    ctx.db.transaction(async (tx) => {
      const found = await findByToken(tx, input.token)
      if (!found) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invitation not found.",
        })
      }
      // Lock the row: two tabs accepting at once must not both succeed.
      const [invitation] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.id, found.invitation.id))
        .for("update")
      const status = invitationStatus(invitation!)
      if (status !== "pending") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: UNAVAILABLE[status],
        })
      }
      if (ctx.user.email.toLowerCase() !== invitation!.email) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `This Invitation was sent to ${invitation!.email}, but you're signed in as ${ctx.user.email}. Sign in with ${invitation!.email} to accept it.`,
        })
      }

      const scope = organizationScope(tx, found.organization.id)
      const [membership] = await tx
        .insert(memberships)
        .values({
          organizationId: found.organization.id,
          userId: ctx.user.id,
          role: invitation!.role,
        })
        .onConflictDoNothing({
          target: [memberships.organizationId, memberships.userId],
        })
        .returning()
      await scope.update(invitations, invitation!.id, {
        acceptedAt: new Date(),
        acceptedById: ctx.user.id,
      })
      return {
        organization: found.organization,
        role: membership?.role ?? null,
        alreadyMember: !membership,
      }
    })
  ),
})
