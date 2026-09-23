import { accountRouter } from "./routers/account"
import { authRouter } from "./routers/auth"
import { catalogItemRouter } from "./routers/catalog-item"
import { contactRouter } from "./routers/contact"
import { healthRouter } from "./routers/health"
import { invitationRouter } from "./routers/invitation"
import { membershipRouter } from "./routers/membership"
import { organizationRouter } from "./routers/organization"
import { platformRouter } from "./routers/platform"
import { resourceRoleRouter } from "./routers/resource-role"
import { settingsRouter } from "./routers/settings"
import { userRouter } from "./routers/user"
import { createCallerFactory, createTRPCRouter } from "./trpc"

/**
 * The application router. One sub-router per feature area, each in
 * `src/routers/<area>.ts`, registered here under its area name.
 */
export const appRouter = createTRPCRouter({
  account: accountRouter,
  auth: authRouter,
  catalogItem: catalogItemRouter,
  contact: contactRouter,
  health: healthRouter,
  invitation: invitationRouter,
  membership: membershipRouter,
  organization: organizationRouter,
  platform: platformRouter,
  resourceRole: resourceRoleRouter,
  settings: settingsRouter,
  user: userRouter,
})

export type AppRouter = typeof appRouter

/** Server-side caller: `createCaller(ctx).health.check()`. */
export const createCaller = createCallerFactory(appRouter)
