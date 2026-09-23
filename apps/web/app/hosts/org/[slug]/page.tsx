import type { Metadata } from "next"

import { Dashboard } from "@/components/dashboard/dashboard"
import { HydrateClient, prefetchNow, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Dashboard · CPQ Express" }

/** An Organization's home is its Dashboard. */
export default async function DashboardPage() {
  // The tiles read with `useSuspenseQuery`: settle both before rendering.
  await Promise.all([
    prefetchNow(trpc.dashboard.overview.queryOptions()),
    prefetchNow(trpc.quote.insights.queryOptions()),
  ])
  return (
    <HydrateClient>
      <Dashboard />
    </HydrateClient>
  )
}
