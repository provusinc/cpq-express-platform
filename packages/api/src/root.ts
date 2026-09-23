import { authRouter } from "./routers/auth"
import { healthRouter } from "./routers/health"
import { membershipRouter } from "./routers/membership"
import { organizationRouter } from "./routers/organization"
import { userRouter } from "./routers/user"
import { createCallerFactory, createTRPCRouter } from "./trpc"

/**
 * The application router. One sub-router per feature area, each in
 * `src/routers/<area>.ts`, registered here under its area name.
 */
export const appRouter = createTRPCRouter({
  auth: authRouter,
  health: healthRouter,
  membership: membershipRouter,
  organization: organizationRouter,
  user: userRouter,
})

export type AppRouter = typeof appRouter

/** Server-side caller: `createCaller(ctx).health.check()`. */
export const createCaller = createCallerFactory(appRouter)
