import { healthRouter } from "./routers/health"
import { createCallerFactory, createTRPCRouter } from "./trpc"

/**
 * The application router. One sub-router per feature area, each in
 * `src/routers/<area>.ts`, registered here under its area name.
 */
export const appRouter = createTRPCRouter({
  health: healthRouter,
})

export type AppRouter = typeof appRouter

/** Server-side caller: `createCaller(ctx).health.check()`. */
export const createCaller = createCallerFactory(appRouter)
