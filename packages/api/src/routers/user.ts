import { z } from "zod"

import { eq, schema } from "@workspace/db"

import { authedProcedure, createTRPCRouter } from "../trpc"

const { userPreferences } = schema

/** A list column id (the web app's), e.g. "validUntil". */
const columnId = z.string().trim().min(1).max(50)
const columnIds = z.array(columnId).max(50)

export const userRouter = createTRPCRouter({
  /** The signed-in User. */
  me: authedProcedure.query(({ ctx }) => ctx.user),

  /**
   * The signed-in User's UI preferences (defaults until first saved). They
   * are the User's own, across Organizations and devices.
   */
  preferences: authedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, ctx.user.id))
      .limit(1)
    return {
      /** Column order (ids) and hidden columns; empty = the default layout. */
      quoteListColumns: {
        order: row?.quoteListColumns ?? [],
        hidden: row?.quoteListHiddenColumns ?? [],
      },
    }
  }),

  /** Saves the Quote list's column order and hidden columns. */
  setQuoteListColumns: authedProcedure
    .input(z.object({ order: columnIds, hidden: columnIds }))
    .mutation(async ({ ctx, input }) => {
      const order = [...new Set(input.order)]
      const hidden = [...new Set(input.hidden)]
      await ctx.db
        .insert(userPreferences)
        .values({
          userId: ctx.user.id,
          quoteListColumns: order,
          quoteListHiddenColumns: hidden,
        })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: {
            quoteListColumns: order,
            quoteListHiddenColumns: hidden,
            updatedAt: new Date(),
          },
        })
      return { order, hidden }
    }),
})
