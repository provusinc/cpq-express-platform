import { TRPCError } from "@trpc/server"
import { z } from "zod"

import {
  and,
  count,
  createDefaultQuoteStatuses,
  desc,
  eq,
  isNull,
  organizationScope,
  schema,
  sql,
} from "@workspace/db"

import { currencyInput, emailInput, slugInput } from "../inputs"
import { invitationStatus, issueInvitation } from "../invitations"
import { createTRPCRouter, platformProcedure } from "../trpc"

const { invitations, memberships, organizations } = schema

/**
 * The Platform Admin console (`admin.` surface): provisioning Organizations
 * and inviting their first Admins. Platform Admins get no Organization data
 * beyond what's listed here (ADR-0001).
 */
export const platformRouter = createTRPCRouter({
  /** Every Organization, newest first, with member and open-Invitation counts. */
  listOrganizations: platformProcedure.query(async ({ ctx }) => {
    const memberCounts = ctx.db
      .select({
        organizationId: memberships.organizationId,
        count: count().as("member_count"),
      })
      .from(memberships)
      .groupBy(memberships.organizationId)
      .as("member_counts")
    const rows = await ctx.db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        currencyCode: organizations.currencyCode,
        createdAt: organizations.createdAt,
        memberCount: sql<number>`coalesce(${memberCounts.count}, 0)::int`,
      })
      .from(organizations)
      .leftJoin(memberCounts, eq(memberCounts.organizationId, organizations.id))
      .orderBy(desc(organizations.createdAt), desc(organizations.id))

    // Open Invitations, to show who has been invited but hasn't joined. The
    // platform tier reads across Organizations by design (no scope).
    const open = await ctx.db
      .select({
        organizationId: invitations.organizationId,
        email: invitations.email,
        role: invitations.role,
        acceptedAt: invitations.acceptedAt,
        revokedAt: invitations.revokedAt,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .orderBy(invitations.createdAt)
    return rows.map((row) => ({
      ...row,
      invitations: open
        .filter((i) => i.organizationId === row.id)
        .map((i) => ({
          email: i.email,
          role: i.role,
          status: invitationStatus(i),
          expiresAt: i.expiresAt,
        })),
    }))
  }),

  /**
   * Provisions an Organization. The slug must be a valid, unreserved DNS
   * label (BAD_REQUEST) and not taken (CONFLICT); it can never change
   * afterwards. With `adminEmail`, also invites the first Admin.
   */
  createOrganization: platformProcedure
    .input(
      z.object({
        name: z.string().trim().min(1, "Enter a name.").max(200),
        slug: slugInput,
        currencyCode: currencyInput,
        adminEmail: emailInput.optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const [organization] = await tx
          .insert(organizations)
          .values({
            name: input.name,
            slug: input.slug,
            currencyCode: input.currencyCode,
          })
          .onConflictDoNothing({ target: organizations.slug })
          .returning()
        if (!organization) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `The slug "${input.slug}" is already taken.`,
          })
        }
        await createDefaultQuoteStatuses(organizationScope(tx, organization.id))
        const invitation = input.adminEmail
          ? await issueInvitation(
              { ...ctx, db: tx },
              {
                organization,
                email: input.adminEmail,
                role: "admin",
                invitedBy: ctx.user,
              }
            )
          : null
        return {
          organization,
          invitation: invitation && {
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            expiresAt: invitation.expiresAt,
          },
        }
      })
    ),

  /**
   * Invites an Admin to an Organization (normally its first). Replaces any
   * open Invitation for the same email; CONFLICT if they're already a member.
   */
  inviteAdmin: platformProcedure
    .input(z.object({ organizationId: z.uuid(), email: emailInput }))
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        const [organization] = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.id, input.organizationId))
          .limit(1)
        if (!organization) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Organization not found.",
          })
        }
        const invitation = await issueInvitation(
          { ...ctx, db: tx },
          {
            organization,
            email: input.email,
            role: "admin",
            invitedBy: ctx.user,
          }
        )
        return {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        }
      })
    ),
})
