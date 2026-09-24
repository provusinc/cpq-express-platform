import type { Metadata } from "next"

import { MembersPage } from "@/components/members/members-page"
import { AdminsOnly } from "@/components/organizations/no-access"
import { PageHeader } from "@/components/shell/page-header"
import { appUrl } from "@/lib/urls"
import { getCaller, HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Members · CPQ Express" }

/** Members and pending Invitations — Admins only (the API checks again). */
export default async function MembersRoute() {
  // The layout has already checked the Membership.
  const { membership } = await (await getCaller()).organization.current()
  if (membership.role !== "admin") {
    return (
      <>
        <PageHeader title="Members" />
        <AdminsOnly />
      </>
    )
  }
  prefetch(trpc.membership.list.queryOptions())
  prefetch(trpc.invitation.list.queryOptions())
  return (
    <HydrateClient>
      <MembersPage
        currentMembershipId={membership.id}
        pickerUrl={appUrl("/?choose")}
      />
    </HydrateClient>
  )
}
