"use client"

import type { QueryClient } from "@tanstack/react-query"
import { QueryClientProvider } from "@tanstack/react-query"
import { createTRPCClient, httpBatchStreamLink, loggerLink } from "@trpc/client"
import { createTRPCContext } from "@trpc/tanstack-react-query"
import { useState } from "react"
import superjson from "superjson"

import type { AppRouter } from "@workspace/api"

import { createQueryClient } from "./query-client"

/**
 * Client components: `const trpc = useTRPC()` then
 * `useQuery(trpc.health.check.queryOptions())` /
 * `useMutation(trpc.x.y.mutationOptions())`.
 */
export const { useTRPC, TRPCProvider } = createTRPCContext<AppRouter>()

let browserQueryClient: QueryClient | undefined

function getQueryClient() {
  // Server render: always a fresh client. Browser: reuse one across renders.
  if (typeof window === "undefined") return createQueryClient()
  return (browserQueryClient ??= createQueryClient())
}

export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient()

  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        loggerLink({
          enabled: (op) =>
            process.env.NODE_ENV === "development" ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        httpBatchStreamLink({
          transformer: superjson,
          // Same-origin: every subdomain serves its own /api/trpc.
          url:
            (typeof window === "undefined"
              ? `http://localhost:${process.env.PORT ?? 3000}`
              : "") + "/api/trpc",
          headers() {
            const headers = new Headers()
            headers.set("x-trpc-source", "nextjs-react")
            return headers
          },
        }),
      ],
    })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  )
}
