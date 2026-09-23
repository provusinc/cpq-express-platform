"use client"

import { useSuspenseQuery } from "@tanstack/react-query"

import { useTRPC } from "@/trpc/react"

/** Shows `health.check`, prefetched on the server and hydrated here. */
export function HealthStatus() {
  const trpc = useTRPC()
  const { data } = useSuspenseQuery(trpc.health.check.queryOptions())

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 font-mono text-xs">
      <dt className="text-muted-foreground">api</dt>
      <dd>{data.status}</dd>
      <dt className="text-muted-foreground">database</dt>
      <dd>
        {data.database.connected
          ? `connected (${data.database.latencyMs} ms)`
          : `unreachable: ${data.database.error}`}
      </dd>
      <dt className="text-muted-foreground">checked</dt>
      <dd>{data.checkedAt.toISOString()}</dd>
    </dl>
  )
}
