import { authedProcedure, createTRPCRouter } from "../trpc"

export const userRouter = createTRPCRouter({
  /** The signed-in User. */
  me: authedProcedure.query(({ ctx }) => ctx.user),
})
