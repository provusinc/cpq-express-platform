import { AdminsOnly } from "@/components/organizations/no-access"
import { SettingsTabs } from "@/components/settings/settings-tabs"
import { PageHeader } from "@/components/shell/page-header"
import { getCaller } from "@/trpc/server"

/**
 * Organization settings — Admins only (the nav hides it for other Roles, and
 * every settings command is `settings.manage` in the API). Each tab is a
 * route under `settings/`, listed in `SETTINGS_TABS`.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // The Organization layout has already checked the Membership.
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
    <>
      <PageHeader
        title="Settings"
        description="How your Organization quotes, and how CPQ Express speaks to your team."
      />
      <div className="grid gap-6 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10">
        <SettingsTabs />
        <div className="max-w-3xl min-w-0 lg:border-l lg:pl-10">{children}</div>
      </div>
    </>
  )
}
