import type { Metadata } from "next"

import { AdminsOnly } from "@/components/organizations/no-access"
import { PageHeader } from "@/components/shell/page-header"
import { PlaceholderPage } from "@/components/shell/placeholder-page"
import { getCaller } from "@/trpc/server"

export const metadata: Metadata = { title: "Settings · CPQ Express" }

/** Organization settings — Admins only (the nav hides it for other Roles). */
export default async function SettingsPage() {
  // The layout has already checked the Membership.
  const { membership } = await (await getCaller()).organization.current()
  if (membership.role !== "admin") {
    return (
      <>
        <PageHeader title="Settings" />
        <AdminsOnly />
      </>
    )
  }
  return (
    <PlaceholderPage
      title="Settings"
      description="Members, Hours Per Day, labels and document settings."
    />
  )
}
