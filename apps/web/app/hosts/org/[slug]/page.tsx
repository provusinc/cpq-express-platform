import type { Metadata } from "next"

import { DEFAULT_VALUE_RANGE } from "@workspace/domain/dashboard"

import { Dashboard } from "@/components/dashboard/dashboard"
import { HydrateClient, prefetchNow, trpc } from "@/trpc/server"

export const metadata: Metadata = { title: "Dashboard · CPQ Express" }

/** An Organization's home is its Dashboard. */
export default async function DashboardPage() {
  // The tiles read with `useSuspenseQuery`, the chart with `useQuery`
  // (it keeps the previous range while the next loads): settle all three
  // before rendering.
  await Promise.all([
    prefetchNow(trpc.dashboard.overview.queryOptions()),
    prefetchNow(trpc.quote.insights.queryOptions()),
    prefetchNow(
      trpc.dashboard.valueOverTime.queryOptions({ range: DEFAULT_VALUE_RANGE })
    ),
  ])
  return (
    <HydrateClient>
      <Dashboard />
    </HydrateClient>
  )
}
