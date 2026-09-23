import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ShieldIcon } from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { NoAccess } from "@/components/organizations/no-access"
import { adminUrl, appUrl, currentPath, signInUrl } from "@/lib/urls"
import { getCaller } from "@/trpc/server"

export const metadata: Metadata = { title: "Platform console · CPQ Express" }

/** Placeholder for the Platform Admin console (built in #5). */
export default async function AdminHomePage() {
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
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
      <Empty className="max-w-md border bg-background">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldIcon />
          </EmptyMedia>
          <EmptyTitle>Platform console</EmptyTitle>
          <EmptyDescription>
            Signed in as {session.user.email}. Provisioning Organizations and
            inviting their first Admins arrives here next.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <a
            href={appUrl("/?choose")}
            className={buttonVariants({ variant: "outline" })}
          >
            Back to Organizations
          </a>
        </EmptyContent>
      </Empty>
    </main>
  )
}
