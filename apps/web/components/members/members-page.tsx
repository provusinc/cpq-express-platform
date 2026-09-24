"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { useState } from "react"

import { ROLE_LABELS, ROLES } from "@workspace/domain/enums"
import type { Role } from "@workspace/domain/enums"

import { PageHeader } from "@/components/shell/page-header"
import { ViewTabs } from "@/components/shell/view-tabs"
import { useTRPC } from "@/trpc/react"

import { InvitationsTable } from "./invitations-table"
import { InviteMemberDialog } from "./invite-member-dialog"
import { MembersTable } from "./members-table"

type MemberView = "all" | Role | "approvers"

const plural = (label: string) => `${label}s`

/**
 * The Members page: who is in the Organization (Role, Approver, joined) and
 * who has been invited. Tabs narrow the table to a Role or the Approvers. Every change is one command, checked again by the
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

  const [view, setView] = useState<MemberView>("all")
  const inView = (v: MemberView) =>
    members.filter((m) =>
      v === "all" ? true : v === "approvers" ? m.isApprover : m.role === v
    )
  const views = [
    { value: "all" as const, label: "All", count: members.length },
    ...ROLES.map((role) => ({
      value: role,
      label: plural(ROLE_LABELS[role]),
      count: inView(role).length,
    })),
    {
      value: "approvers" as const,
      label: "Approvers",
      count: inView("approvers").length,
    },
  ]

  return (
    <>
      <PageHeader
        title="Members"
        description="Invite people, set their Role and who may approve Quotes. Removing someone keeps their Quotes."
      >
        <InviteMemberDialog />
      </PageHeader>
      <ViewTabs
        label="Members by Role"
        views={views}
        value={view}
        onValueChange={setView}
        summary={
          invitations.length > 0
            ? `${invitations.length} pending ${invitations.length === 1 ? "Invitation" : "Invitations"}`
            : undefined
        }
      />
      <MembersTable
        members={members}
        rows={inView(view)}
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
