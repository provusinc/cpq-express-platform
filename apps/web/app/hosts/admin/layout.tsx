import { redirect } from "next/navigation"

import { NoAccess } from "@/components/organizations/no-access"
import { PlatformHeader } from "@/components/platform/platform-header"
import { adminUrl, appUrl, currentPath, signInUrl } from "@/lib/urls"
import { getCaller } from "@/trpc/server"

/**
 * The Platform Admin console (`admin.` surface). Signed-out visitors go to
 * sign-in and back; signed-in Users who aren't Platform Admins are refused.
 * Every procedure re-checks this on the platform tier.
 */
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await (await getCaller()).auth.getSession()
  if (!session) redirect(signInUrl(adminUrl(await currentPath())))
  if (!session.user.isPlatformAdmin) {
    return (
      <NoAccess
        email={session.user.email}
        pickerUrl={appUrl()}
        title="The platform console is for Provus staff"
        reason="which isn't a Platform Admin."
      />
    )
  }

  return (
    <div className="flex min-h-svh flex-col bg-canvas">
      <PlatformHeader
        email={session.user.email}
        organizationsUrl={appUrl("/?choose")}
        signedOutUrl={appUrl("/sign-in")}
      />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6">
        {children}
      </main>
    </div>
  )
}
