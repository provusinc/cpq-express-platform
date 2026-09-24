import "server-only"

import type { TRPCQueryOptions } from "@trpc/tanstack-react-query"
import { dehydrate, HydrationBoundary } from "@tanstack/react-query"
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query"
import { headers } from "next/headers"
import { cache } from "react"

import { appRouter, createCaller, createTRPCContext } from "@workspace/api"
import { db } from "@workspace/db/client"

import { createQueryClient } from "./query-client"

/** One tRPC context per request (React `cache` dedupes within a render). */
const createContext = cache(async () => {
  const heads = new Headers(await headers())
  heads.set("x-trpc-source", "rsc")
  return createTRPCContext({ headers: heads, db })
})

/** One QueryClient per request. */
export const getQueryClient = cache(createQueryClient)

/**
 * RSC prefetch: `prefetch(trpc.health.check.queryOptions())` in a server
 * component, wrap the client subtree in `<HydrateClient>`, and read it there
 * with `useQuery`/`useSuspenseQuery(trpc.health.check.queryOptions())`.
 */
export const trpc = createTRPCOptionsProxy({
  router: appRouter,
  ctx: createContext,
  queryClient: getQueryClient,
})

/** Direct server-side call when you need the data itself in an RSC. */
export async function getCaller() {
  return createCaller(await createContext())
}

export function HydrateClient({ children }: { children: React.ReactNode }) {
  return (
    <HydrationBoundary state={dehydrate(getQueryClient())}>
      {children}
    </HydrationBoundary>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prefetch<T extends ReturnType<TRPCQueryOptions<any>>>(
  queryOptions: T
) {
  const queryClient = getQueryClient()
  if (queryOptions.queryKey[1]?.type === "infinite") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void queryClient.prefetchInfiniteQuery(queryOptions as any)
  } else {
    void queryClient.prefetchQuery(queryOptions)
  }
}

/**
 * `prefetch`, awaited: the query is settled before the page renders, so a
 * client component reading it with `useQuery` renders the same rows on the
 * server as at hydration. Use it for what a page shows first through
 * `useQuery` (server-paged lists): a streamed, still-pending prefetch
 * renders the loading state on the server but the data on the client (a
 * hydration mismatch).
 */
export async function prefetchNow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryOptions: ReturnType<TRPCQueryOptions<any>>
) {
  await getQueryClient().prefetchQuery(queryOptions)
}
