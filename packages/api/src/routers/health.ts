import { sql } from "@workspace/db"

import { createTRPCRouter, publicProcedure } from "../trpc"

export const healthRouter = createTRPCRouter({
  /** Liveness plus database connectivity (`select 1`). Never throws. */
  check: publicProcedure.query(async ({ ctx }) => {
    const started = performance.now()
    let database:
      | { connected: true; latencyMs: number }
      | {
          connected: false
          error: string
        }
    try {
      await ctx.db.execute(sql`select 1`)
      database = {
        connected: true,
        latencyMs: Math.round(performance.now() - started),
      }
    } catch (error) {
      database = {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    return {
      status: database.connected ? ("ok" as const) : ("degraded" as const),
      database,
      checkedAt: new Date(),
    }
  }),
})
