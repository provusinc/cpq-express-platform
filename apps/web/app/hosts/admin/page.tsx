import type { Metadata } from "next"

import { OrganizationsConsole } from "@/components/platform/organizations-console"
import { env } from "@/env"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Platform console · CPQ Express" }

/** Organizations: provision one, invite its first Admin, see them all. */
export default function PlatformHomePage() {
  // The layout has already checked the Platform Admin flag.
  prefetch(trpc.platform.listOrganizations.queryOptions())
  return (
    <HydrateClient>
      <OrganizationsConsole appUrl={env.APP_URL} rootDomain={env.ROOT_DOMAIN} />
    </HydrateClient>
  )
}
