"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { PageHeader } from "@/components/shell/page-header"
import { useTRPC } from "@/trpc/react"

import { InvitationsTable } from "./invitations-table"
import { InviteMemberDialog } from "./invite-member-dialog"
import { MembersTable } from "./members-table"

/**
 * The Members page: who is in the Organization (Role, Approver, joined) and
 * who has been invited. Every change is one command, checked again by the
 * API (Admin only, last-Admin guard).
 */
export function MembersPage({
  currentMembershipId,
  pickerUrl,
}: {
  /** The viewing Admin's own Membership ("You"). */
  currentMembershipId: string
  /** Where to go after removing yourself. */
  pickerUrl: string
}) {
  const trpc = useTRPC()
  const { data: members } = useSuspenseQuery(
    trpc.membership.list.queryOptions()
  )
  const { data: invitations } = useSuspenseQuery(
    trpc.invitation.list.queryOptions()
  )

  return (
    <>
      <PageHeader
        title="Members"
        description="Invite people, set their Role and who may approve Quotes. Removing someone keeps their Quotes."
      >
        <InviteMemberDialog />
      </PageHeader>
      <MembersTable
        members={members}
        currentMembershipId={currentMembershipId}
        pickerUrl={pickerUrl}
      />
      {invitations.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">
            Pending Invitations{" "}
            <span className="text-muted-foreground">
              ({invitations.length})
            </span>
          </h2>
          <InvitationsTable invitations={invitations} />
        </section>
      )}
    </>
  )
}
