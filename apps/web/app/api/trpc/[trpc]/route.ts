import { fetchRequestHandler } from "@trpc/server/adapters/fetch"

import { appRouter, createTRPCContext } from "@workspace/api"
import { db } from "@workspace/db/client"

function handler(req: Request) {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: () => createTRPCContext({ headers: req.headers, db }),
    onError({ error, path }) {
      console.error(`>>> tRPC error on '${path ?? "<no-path>"}':`, error)
    },
  })
}

export { handler as GET, handler as POST }
