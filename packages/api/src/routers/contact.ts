import { z } from "zod"

import { eq, ne, schema, uuidv7 } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"

import { notFound } from "../errors"
import {
  optionalEmail,
  optionalText,
  requiredText,
  stripUndefined,
} from "../inputs"
import { createTRPCRouter, organizationProcedure } from "../trpc"

const { accounts, contacts } = schema

const contactFields = {
  email: optionalEmail,
  phone: optionalText(50),
  title: optionalText(200),
}

/** Clears the primary flag on the Account's other Contacts. */
async function clearOtherPrimaries(
  scope: OrganizationScope,
  accountId: string,
  keepId: string
) {
  await scope.db
    .update(contacts)
    .set({ isPrimary: false })
    .where(
      scope.where(
        contacts,
        eq(contacts.accountId, accountId),
        eq(contacts.isPrimary, true),
        ne(contacts.id, keepId)
      )
    )
}

/**
 * Contacts at an Account. Any member may manage them; they always belong to
 * one Account, and at most one per Account is primary.
 */
export const contactRouter = createTRPCRouter({
  /**
   * Adds a Contact to an Account. The Account's first Contact becomes its
   * primary Contact; `isPrimary: true` makes this one primary instead of
   * the current one.
   */
  create: organizationProcedure
    .input(
      z.object({
        accountId: z.uuid(),
        name: requiredText(200),
        ...contactFields,
        isPrimary: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input: { isPrimary, ...values } }) =>
      ctx.scope.transaction(async (scope) => {
        const account = await scope.findById(accounts, values.accountId)
        if (!account) throw notFound("Account")
        const [existing] = await scope.findMany(contacts, {
          where: eq(contacts.accountId, account.id),
          limit: 1,
        })
        const primary = isPrimary ?? !existing
        const id = uuidv7()
        if (primary) await clearOtherPrimaries(scope, account.id, id)
        return scope.insert(contacts, {
          ...stripUndefined(values),
          id,
          isPrimary: primary,
        })
      })
    ),

  /** Edits a Contact's details. Omitted fields keep their value. */
  update: organizationProcedure
    .input(
      z.object({
        id: z.uuid(),
        name: requiredText(200).optional(),
        ...contactFields,
      })
    )
    .mutation(async ({ ctx, input: { id, ...changes } }) => {
      const updated = await ctx.scope.update(
        contacts,
        id,
        stripUndefined(changes)
      )
      if (!updated) throw notFound("Contact")
      return updated
    }),

  /** Makes this Contact its Account's primary Contact (the only one). */
  setPrimary: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const contact = await scope.findById(contacts, input.id)
        if (!contact) throw notFound("Contact")
        await clearOtherPrimaries(scope, contact.accountId, contact.id)
        return (await scope.update(contacts, contact.id, { isPrimary: true }))!
      })
    ),

  /** Deletes a Contact (always allowed; Quotes never reference Contacts). */
  delete: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.scope.delete(contacts, input.id)
      if (!deleted) throw notFound("Contact")
      return { id: deleted.id }
    }),
})
