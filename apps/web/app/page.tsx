import { Suspense } from "react"

import { HealthStatus } from "@/components/system/health-status"
import { HydrateClient, prefetch, trpc } from "@/trpc/server"

// Rendered per request: the health check must hit the live database.
export const dynamic = "force-dynamic"

export default function Page() {
  prefetch(trpc.health.check.queryOptions())

  return (
    <main className="flex min-h-svh p-6">
      <div className="flex max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
        <h1 className="font-medium">CPQ Express</h1>
        <HydrateClient>
          <Suspense
            fallback={<p className="text-muted-foreground">Checking…</p>}
          >
            <HealthStatus />
          </Suspense>
        </HydrateClient>
      </div>
    </main>
  )
}
