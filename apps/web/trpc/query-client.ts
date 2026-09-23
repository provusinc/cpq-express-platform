import { defaultShouldDehydrateQuery, QueryClient } from "@tanstack/react-query"
import superjson from "superjson"

/** One QueryClient factory for server (per request) and browser (singleton). */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Avoid an immediate client refetch of data the server just prefetched.
        staleTime: 30 * 1000,
      },
      dehydrate: {
        serializeData: superjson.serialize,
        // Also stream still-pending prefetches from RSC to the client.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
        shouldRedactErrors: () => false,
      },
      hydrate: {
        deserializeData: superjson.deserialize,
      },
    },
  })
}
