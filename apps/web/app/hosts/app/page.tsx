import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { BrandLockup } from "@/components/brand/brand"
import { OrganizationPicker } from "@/components/organizations/organization-picker"
import { adminUrl, organizationUrl } from "@/lib/urls"
import { getCaller } from "@/trpc/server"

export const metadata: Metadata = { title: "Organizations · CPQ Express" }

/**
 * Home of the app host: the Organization picker. With exactly one Membership
 * (and not a Platform Admin) the User goes straight to that Organization;
 * `?choose` always shows the picker.
 */
export default async function OrganizationPickerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const caller = await getCaller()
  const session = await caller.auth.getSession()
  if (!session) redirect("/sign-in")

  const memberships = await caller.organization.listMine()
  const organizations = memberships.map(({ organization, role }) => ({
    slug: organization.slug,
    name: organization.name,
    role,
    url: organizationUrl(organization.slug),
  }))

  const { choose } = await searchParams
  if (
    organizations.length === 1 &&
    !session.user.isPlatformAdmin &&
    choose === undefined
  ) {
    redirect(organizations[0]!.url)
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-canvas p-6">
      <div className="flex w-full max-w-md flex-col gap-6">
        <BrandLockup className="self-center" />
        <OrganizationPicker
          email={session.user.email}
          organizations={organizations}
          adminConsoleUrl={
            session.user.isPlatformAdmin ? adminUrl() : undefined
          }
        />
      </div>
    </main>
  )
}
