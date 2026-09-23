import { and, eq } from "drizzle-orm"

import { hashInvitationToken } from "../invitation-token"
import type { Db } from "../index"
import { invitations } from "../schema"
import type { Organization } from "../schema"

/**
 * A pending Invitation to `acme` for someone who hasn't signed up, with a
 * fixed token so it can be opened straight away:
 * http://app.localtest.me:3000/invitations/acme-demo-invitation
 * (sign in as invitee@acme.test via Mailpit to accept it). Re-seeding
 * replaces it with a fresh, unexpired one.
 */
export const SEED_INVITATION = {
  email: "invitee@acme.test",
  role: "member",
  token: "acme-demo-invitation",
} as const

export async function seedInvitations(
  db: Db,
  organizations: Record<"acme", Organization>
) {
  const acme = organizations.acme
  await db
    .delete(invitations)
    .where(
      and(
        eq(invitations.organizationId, acme.id),
        eq(invitations.email, SEED_INVITATION.email)
      )
    )
  await db.insert(invitations).values({
    organizationId: acme.id,
    email: SEED_INVITATION.email,
    role: SEED_INVITATION.role,
    tokenHash: hashInvitationToken(SEED_INVITATION.token),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })
}
