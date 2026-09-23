import { createTRPCRouter, publicProcedure } from "../trpc"

export const authRouter = createTRPCRouter({
  /** The current session, or null when signed out. Never throws. */
  getSession: publicProcedure.query(({ ctx }) => ctx.session),
})
