import { TRPCError } from "@trpc/server"
import { redirect } from "next/navigation"

import { NoAccess } from "@/components/organizations/no-access"
import { AppShell } from "@/components/shell/app-shell"
import { getCatalogTypes } from "@/components/shell/get-catalog-types"
import { getLabels } from "@/components/shell/get-labels"
import { appUrl, currentPath, organizationUrl, signInUrl } from "@/lib/urls"
import { getCaller } from "@/trpc/server"

/**
 * Every Organization page renders inside this layout, which performs the
 * same Membership check as `organizationProcedure`:
 * - signed out → sign in on `app.`, then back to this URL;
 * - no Membership (or no such Organization) → "no access", identically;
 * - otherwise → the app shell.
 * Data calls re-check through the organization tier on every request.
 */
export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const caller = await getCaller()

  const session = await caller.auth.getSession()
  if (!session) {
    redirect(signInUrl(organizationUrl(slug, await currentPath())))
  }

  const current = await caller.organization.current().catch((error) => {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") return null
    throw error
  })
  if (!current) {
    return <NoAccess email={session.user.email} pickerUrl={appUrl()} />
  }

  const [mine, labels, catalogTypes] = await Promise.all([
    caller.organization.listMine(),
    getLabels(),
    getCatalogTypes(),
  ])
  const toShell = (o: { slug: string; name: string }) => ({
    slug: o.slug,
    name: o.name,
    url: organizationUrl(o.slug),
  })

  return (
    <AppShell
      organization={toShell(current.organization)}
      organizations={mine.map((m) => toShell(m.organization))}
      isAdmin={current.membership.role === "admin"}
      isApprover={current.membership.isApprover}
      labels={labels}
      catalogTypes={catalogTypes}
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
      pickerUrl={appUrl("/?choose")}
      signedOutUrl={appUrl("/sign-in")}
    >
      {children}
    </AppShell>
  )
}
