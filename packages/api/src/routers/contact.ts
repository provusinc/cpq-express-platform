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

const { customers, contacts } = schema

const contactFields = {
  email: optionalEmail,
  phone: optionalText(50),
  title: optionalText(200),
}

/** Clears the primary flag on the Customer's other Contacts. */
async function clearOtherPrimaries(
  scope: OrganizationScope,
  customerId: string,
  keepId: string
) {
  await scope.db
    .update(contacts)
    .set({ isPrimary: false })
    .where(
      scope.where(
        contacts,
        eq(contacts.customerId, customerId),
        eq(contacts.isPrimary, true),
        ne(contacts.id, keepId)
      )
    )
}

/**
 * Contacts at a Customer. Any member may manage them; they always belong to
 * one Customer, and at most one per Customer is primary.
 */
export const contactRouter = createTRPCRouter({
  /**
   * Adds a Contact to a Customer. The Customer's first Contact becomes its
   * primary Contact; `isPrimary: true` makes this one primary instead of
   * the current one.
   */
  create: organizationProcedure
    .input(
      z.object({
        customerId: z.uuid(),
        name: requiredText(200),
        ...contactFields,
        isPrimary: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input: { isPrimary, ...values } }) =>
      ctx.scope.transaction(async (scope) => {
        const customer = await scope.findById(customers, values.customerId)
        if (!customer) throw notFound("Customer")
        const [existing] = await scope.findMany(contacts, {
          where: eq(contacts.customerId, customer.id),
          limit: 1,
        })
        const primary = isPrimary ?? !existing
        const id = uuidv7()
        if (primary) await clearOtherPrimaries(scope, customer.id, id)
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

  /** Makes this Contact its Customer's primary Contact (the only one). */
  setPrimary: organizationProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const contact = await scope.findById(contacts, input.id)
        if (!contact) throw notFound("Contact")
        await clearOtherPrimaries(scope, contact.customerId, contact.id)
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
