import { accountRouter } from "./routers/account"
import { allocationRouter } from "./routers/allocation"
import { authRouter } from "./routers/auth"
import { catalogItemRouter } from "./routers/catalog-item"
import { contactRouter } from "./routers/contact"
import { healthRouter } from "./routers/health"
import { invitationRouter } from "./routers/invitation"
import { lineItemRouter } from "./routers/line-item"
import { membershipRouter } from "./routers/membership"
import { milestoneRouter } from "./routers/milestone"
import { organizationRouter } from "./routers/organization"
import { phaseRouter } from "./routers/phase"
import { platformRouter } from "./routers/platform"
import { quoteRouter } from "./routers/quote"
import { quoteDocumentRouter } from "./routers/quote-document"
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
  allocation: allocationRouter,
  auth: authRouter,
  catalogItem: catalogItemRouter,
  contact: contactRouter,
  health: healthRouter,
  invitation: invitationRouter,
  lineItem: lineItemRouter,
  membership: membershipRouter,
  milestone: milestoneRouter,
  organization: organizationRouter,
  phase: phaseRouter,
  platform: platformRouter,
  quote: quoteRouter,
  quoteDocument: quoteDocumentRouter,
  resourceRole: resourceRoleRouter,
  settings: settingsRouter,
  user: userRouter,
})

export type AppRouter = typeof appRouter

/** Server-side caller: `createCaller(ctx).health.check()`. */
export const createCaller = createCallerFactory(appRouter)
