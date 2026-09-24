import { TRPCError } from "@trpc/server"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AcceptInvitation } from "@/components/invitations/accept-invitation"
import { InvitationUnavailable } from "@/components/invitations/invitation-unavailable"
import { appUrl, organizationUrl, signInUrl } from "@/lib/urls"
import { getCaller } from "@/trpc/server"

export const metadata: Metadata = { title: "Invitation · CPQ Express" }

/**
 * The emailed Invitation link. Unusable Invitations (unknown, expired,
 * revoked, used) explain themselves without signing in; a pending one sends
 * a signed-out visitor to sign in (with the invited email pre-filled) and
 * back here, then offers Accept.
 */
export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const caller = await getCaller()
  const invitation = await caller.invitation
    .byToken({ token })
    .catch((error) => {
      if (error instanceof TRPCError && error.code === "NOT_FOUND") return null
      throw error
    })

  if (!invitation) {
    return (
      <InvitationUnavailable
        title="This Invitation link doesn't work"
        message="It may have been replaced by a newer Invitation. Use the latest email you received, or ask an Admin to invite you again."
      />
    )
  }

  const session = await caller.auth.getSession()
  const selfUrl = appUrl(`/invitations/${encodeURIComponent(token)}`)
  const url = organizationUrl(invitation.organization.slug)

  if (invitation.status !== "pending") {
    // Someone who already joined gets a way in rather than a dead end.
    const mine = session ? await caller.organization.listMine() : []
    const isMember = mine.some(
      (m) => m.organization.slug === invitation.organization.slug
    )
    return (
      <InvitationUnavailable
        title={
          invitation.status === "accepted"
            ? "This Invitation has been used"
            : invitation.status === "expired"
              ? "This Invitation has expired"
              : "This Invitation was withdrawn"
        }
        message={invitation.message ?? ""}
        organization={
          isMember ? { name: invitation.organization.name, url } : undefined
        }
      />
    )
  }

  if (!session) {
    redirect(signInUrl(selfUrl, { email: invitation.email }))
  }

  return (
    <AcceptInvitation
      token={token}
      invitation={{
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        organizationName: invitation.organization.name,
      }}
      signedInAs={session.user.email}
      organizationUrl={url}
      switchAccountUrl={signInUrl(selfUrl, { email: invitation.email })}
    />
  )
}
