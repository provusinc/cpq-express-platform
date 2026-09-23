import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server"

import type { AppRouter } from "./root"

export { appRouter, createCaller } from "./root"
export type { AppRouter } from "./root"
export { createTRPCContext } from "./trpc"
export { ORGANIZATION_SLUG_HEADER } from "./headers"
export type { CreateContextOptions, TRPCContext } from "./trpc"
export type { InvitationStatus } from "./invitations"

/** `RouterInputs["health"]["check"]` */
export type RouterInputs = inferRouterInputs<AppRouter>
/** `RouterOutputs["health"]["check"]` */
export type RouterOutputs = inferRouterOutputs<AppRouter>
