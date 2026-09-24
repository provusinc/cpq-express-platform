/**
 * Invitations (glossary: Invitation) — issuing, re-issuing and reading their
 * status. Shared by the platform tier (an Organization's first Admin) and the
 * Members page (everyone else); acceptance lives in `routers/invitation.ts`.
 */
import { TRPCError } from "@trpc/server"

import type { Mailer } from "@workspace/auth/mailer"
import {
  createInvitationToken,
  eq,
  isNull,
  organizationScope,
  schema,
  sql,
} from "@workspace/db"
import type { Db } from "@workspace/db"
import { ROLE_LABELS } from "@workspace/domain/enums"
import type { Role } from "@workspace/domain/enums"

const { invitations, memberships, users } = schema

/** How long an Invitation link works (from sending or the last resend). */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type InvitationStatus = "pending" | "expired" | "accepted" | "revoked"

/** Where an Invitation stands at `now`. */
export function invitationStatus(
  invitation: {
    acceptedAt: Date | null
    revokedAt: Date | null
    expiresAt: Date
  },
  now = new Date()
): InvitationStatus {
  if (invitation.acceptedAt) return "accepted"
  if (invitation.revokedAt) return "revoked"
  if (invitation.expiresAt <= now) return "expired"
  return "pending"
}

/** What issuing needs from the tRPC context. */
export interface InvitationContext {
  db: Db
  mailer: Mailer
  /** Base URL of the `app.` surface, where Invitations are accepted. */
  appUrl: string
}

interface Inviter {
  id: string
  name: string | null
  email: string
}

/** The accept link emailed to the invitee. */
export function invitationUrl(appUrl: string, token: string) {
  return new URL(`/invitations/${token}`, appUrl).toString()
}

/**
 * Creates an Invitation to `organization` for `email` with `role` and emails
 * it. Any earlier open Invitation for the same email is revoked, so the new
 * link is the only one that works. CONFLICT when `email` already belongs to
 * a member. Run inside the command's transaction: if the email can't be
 * sent, nothing is kept.
 */
export async function issueInvitation(
  ctx: InvitationContext,
  {
    organization,
    email,
    role,
    invitedBy,
  }: {
    organization: { id: string; name: string }
    email: string
    role: Role
    invitedBy: Inviter
  }
) {
  const scope = organizationScope(ctx.db, organization.id)
  const address = email.trim().toLowerCase()

  const [member] = await scope.db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(scope.where(memberships, sql`lower(${users.email}) = ${address}`))
    .limit(1)
  if (member) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `${address} is already a member of this Organization.`,
    })
  }

  const now = new Date()
  await scope.db
    .update(invitations)
    .set({ revokedAt: now })
    .where(
      scope.where(
        invitations,
        eq(invitations.email, address),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt)
      )
    )

  const { token, tokenHash } = createInvitationToken()
  const invitation = await scope.insert(invitations, {
    email: address,
    role,
    tokenHash,
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    invitedById: invitedBy.id,
  })
  await sendInvitationEmail(ctx, {
    organization,
    invitation,
    token,
    invitedBy,
  })
  return invitation
}

/**
 * Re-sends an open Invitation with a new token (the old link stops working)
 * and a fresh expiry. PRECONDITION_FAILED once it was accepted or revoked.
 */
export async function reissueInvitation(
  ctx: InvitationContext,
  {
    organization,
    invitation,
    invitedBy,
  }: {
    organization: { id: string; name: string }
    invitation: typeof invitations.$inferSelect
    invitedBy: Inviter
  }
) {
  const status = invitationStatus(invitation)
  if (status === "accepted" || status === "revoked") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `This Invitation was already ${status}.`,
    })
  }
  const { token, tokenHash } = createInvitationToken()
  const updated = await organizationScope(ctx.db, organization.id).update(
    invitations,
    invitation.id,
    {
      tokenHash,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    }
  )
  await sendInvitationEmail(ctx, {
    organization,
    invitation: updated!,
    token,
    invitedBy,
  })
  return updated!
}

async function sendInvitationEmail(
  ctx: InvitationContext,
  {
    organization,
    invitation,
    token,
    invitedBy,
  }: {
    organization: { name: string }
    invitation: { email: string; role: Role; expiresAt: Date }
    token: string
    invitedBy: Inviter
  }
) {
  const url = invitationUrl(ctx.appUrl, token)
  const role = ROLE_LABELS[invitation.role]
  const inviter = invitedBy.name
    ? `${invitedBy.name} (${invitedBy.email})`
    : invitedBy.email
  const expires = invitation.expiresAt.toUTCString()
  const subject = `You're invited to ${organization.name} on CPQ Express`
  const text = [
    `${inviter} invited you to join ${organization.name} on CPQ Express as ${withArticle(role)}.`,
    "",
    `Accept the Invitation: ${url}`,
    "",
    `The link works once and expires on ${expires}. Sign in with ${invitation.email} to accept it.`,
  ].join("\n")
  const html = `<p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(organization.name)}</strong> on CPQ Express as ${escapeHtml(withArticle(role))}.</p>
<p><a href="${escapeHtml(url)}">Accept the Invitation</a></p>
<p style="color:#666">The link works once and expires on ${escapeHtml(expires)}. Sign in with ${escapeHtml(invitation.email)} to accept it.</p>`

  try {
    await ctx.mailer.send({ to: invitation.email, subject, text, html })
  } catch (cause) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The Invitation email couldn't be sent. Try again in a moment.",
      cause,
    })
  }
}

function withArticle(role: string) {
  return /^[AEIOU]/.test(role) ? `an ${role}` : `a ${role}`
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
