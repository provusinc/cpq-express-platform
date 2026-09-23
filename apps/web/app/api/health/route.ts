import { createCaller, createTRPCContext } from "@workspace/api"
import { db } from "@workspace/db/client"

/** Plain-HTTP health check for uptime probes. 503 when the database is down. */
export async function GET(req: Request) {
  const caller = createCaller(createTRPCContext({ headers: req.headers, db }))
  const health = await caller.health.check()
  return Response.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "cache-control": "no-store" },
  })
}
