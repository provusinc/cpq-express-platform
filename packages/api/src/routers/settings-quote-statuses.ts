/**
 * Settings → Quote Statuses (ADR-0004): an Admin manages the Organization's
 * Quote Statuses inside the fixed Quote Stages. Spread into the settings
 * router. Statuses carry no behaviour, so none of this touches a Quote's
 * Stage or writes Approval Steps (whose Status names are snapshots).
 *
 * Every command locks the Organization's Statuses (`FOR UPDATE`) first, so
 * the per-Stage limit, the last-Status guard and name uniqueness hold under
 * concurrent edits; the unique index on `lower(name)` backs the latter.
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { and, asc, count, eq, schema, sql } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import { QUOTE_STAGES } from "@workspace/domain/enums"
import type { QuoteStage } from "@workspace/domain/enums"
import {
  canAddQuoteStatus,
  canDeleteQuoteStatus,
  checkQuoteStatusColour,
  checkQuoteStatusName,
  QUOTE_STATUSES_PER_STAGE_MAX,
} from "@workspace/domain/stages"
import type { QuoteStatusChange } from "@workspace/domain/stages"

import { isUniqueViolation, notFound } from "../errors"
import { organizationProcedure, permittedProcedure } from "../trpc"

const { quoteStatuses, quotes } = schema

const NAME_KEY = "quote_statuses_organization_id_name_key"

const manageSettings = permittedProcedure("settings.manage")

/** A name checked by the domain (trimmed, not blank, not too long). */
const nameInput = z.string().transform((value, ctx) => {
  const check = checkQuoteStatusName(value)
  if (!check.ok) {
    ctx.addIssue({ code: "custom", message: check.message })
    return z.NEVER
  }
  return check.name
})

/** None (`null`) or one of the status tones. */
const colourInput = z
  .string()
  .nullable()
  .transform((value, ctx) => {
    const check = checkQuoteStatusColour(value)
    if (!check.ok) {
      ctx.addIssue({ code: "custom", message: check.message })
      return z.NEVER
    }
    return check.colour
  })

interface StatusRow {
  id: string
  stage: QuoteStage
  name: string
  sequence: number
  colour: string | null
}

/**
 * The Organization's Statuses, locked for the rest of the transaction, in
 * Stage order then their order within the Stage.
 */
function lockStatuses(scope: OrganizationScope): Promise<StatusRow[]> {
  return scope.db
    .select({
      id: quoteStatuses.id,
      stage: quoteStatuses.stage,
      name: quoteStatuses.name,
      sequence: quoteStatuses.sequence,
      colour: quoteStatuses.colour,
    })
    .from(quoteStatuses)
    .where(scope.where(quoteStatuses))
    .orderBy(
      asc(quoteStatuses.stage),
      asc(quoteStatuses.sequence),
      asc(quoteStatuses.id)
    )
    .for("update")
}

/** A refusal of the domain's Quote Status rules as a tRPC error. */
function refusal(change: Exclude<QuoteStatusChange, { ok: true }>) {
  const code =
    change.reason === "stage_full" || change.reason === "last_status"
      ? "PRECONDITION_FAILED"
      : "BAD_REQUEST"
  return new TRPCError({ code, message: change.message })
}

/** Refuses a name another Status of the Organization already has. */
function assertNameFree(
  statuses: StatusRow[],
  name: string,
  exceptId?: string
) {
  const check = checkQuoteStatusName(
    name,
    statuses.filter((s) => s.id !== exceptId).map((s) => s.name)
  )
  if (!check.ok) {
    throw new TRPCError({ code: "CONFLICT", message: check.message })
  }
}

/** Turns a lost race on the name index into the same CONFLICT. */
async function guardName<T>(name: string, write: () => Promise<T>) {
  try {
    return await write()
  } catch (error) {
    if (isUniqueViolation(error, NAME_KEY)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `A Quote Status named “${name}” already exists.`,
      })
    }
    throw error
  }
}

/** How many Quotes sit on the Status. */
async function quotesOnStatus(scope: OrganizationScope, statusId: string) {
  const [row] = await scope.db
    .select({ n: count() })
    .from(quotes)
    .where(scope.where(quotes, eq(quotes.statusId, statusId)))
  return row?.n ?? 0
}

/** One Status as the settings list shows it. */
const view = (row: StatusRow, quoteCount = 0) => ({
  id: row.id,
  stage: row.stage,
  name: row.name,
  sequence: row.sequence,
  colour: row.colour,
  quoteCount,
})

export const quoteStatusSettingsProcedures = {
  /**
   * The Organization's Quote Statuses in Stage order, then their order within
   * the Stage (the first is the Stage's entry Status), each with how many
   * Quotes sit on it. Any member.
   */
  quoteStatuses: organizationProcedure.query(({ ctx }) =>
    ctx.scope.db
      .select({
        id: quoteStatuses.id,
        stage: quoteStatuses.stage,
        name: quoteStatuses.name,
        sequence: quoteStatuses.sequence,
        colour: quoteStatuses.colour,
        quoteCount: sql<number>`count(${quotes.id})::int`,
      })
      .from(quoteStatuses)
      .leftJoin(
        quotes,
        and(
          eq(quotes.organizationId, quoteStatuses.organizationId),
          eq(quotes.statusId, quoteStatuses.id)
        )
      )
      .where(ctx.scope.where(quoteStatuses))
      .groupBy(quoteStatuses.id)
      .orderBy(
        asc(quoteStatuses.stage),
        asc(quoteStatuses.sequence),
        asc(quoteStatuses.id)
      )
  ),

  /**
   * Adds a Status at the end of its Stage (at most
   * `QUOTE_STATUSES_PER_STAGE_MAX` per Stage → PRECONDITION_FAILED; a name
   * already used in the Organization → CONFLICT).
   */
  createQuoteStatus: manageSettings
    .input(
      z.object({
        stage: z.enum(QUOTE_STAGES),
        name: nameInput,
        colour: colourInput.optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const statuses = await lockStatuses(scope)
        const inStage = statuses.filter((s) => s.stage === input.stage)
        const room = canAddQuoteStatus(inStage.length)
        if (!room.ok) throw refusal(room)
        assertNameFree(statuses, input.name)
        const sequence = Math.max(-1, ...inStage.map((s) => s.sequence)) + 1
        const row = await guardName(input.name, () =>
          scope.insert(quoteStatuses, {
            stage: input.stage,
            name: input.name,
            colour: input.colour ?? null,
            sequence,
          })
        )
        return view(row)
      })
    ),

  /**
   * Renames a Status and/or sets its colour (`null` clears it). A rename
   * shows everywhere the Status is read; Approval history keeps the name at
   * the time.
   */
  updateQuoteStatus: manageSettings
    .input(
      z.object({
        id: z.uuid(),
        name: nameInput.optional(),
        colour: colourInput.optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const statuses = await lockStatuses(scope)
        const current = statuses.find((s) => s.id === input.id)
        if (!current) throw notFound("Quote Status")
        if (input.name !== undefined) {
          assertNameFree(statuses, input.name, current.id)
        }
        const changes = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.colour !== undefined ? { colour: input.colour } : {}),
        }
        const row =
          Object.keys(changes).length === 0
            ? current
            : await guardName(input.name ?? current.name, async () => {
                const updated = await scope.update(quoteStatuses, current.id, {
                  ...changes,
                  updatedAt: new Date(),
                })
                if (!updated) throw notFound("Quote Status")
                return updated
              })
        return view(row, await quotesOnStatus(scope, current.id))
      })
    ),

  /**
   * Puts a Stage's Statuses in the given order; `ids` must be exactly that
   * Stage's Statuses (BAD_REQUEST otherwise). The first becomes the Stage's
   * entry Status: new Quotes (Draft) and Quotes entering the Stage land on it.
   */
  reorderQuoteStatuses: manageSettings
    .input(
      z.object({
        stage: z.enum(QUOTE_STAGES),
        ids: z.array(z.uuid()).min(1).max(QUOTE_STATUSES_PER_STAGE_MAX),
      })
    )
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const statuses = await lockStatuses(scope)
        const inStage = statuses.filter((s) => s.stage === input.stage)
        const known = new Set(inStage.map((s) => s.id))
        if (
          new Set(input.ids).size !== input.ids.length ||
          input.ids.length !== inStage.length ||
          !input.ids.every((id) => known.has(id))
        ) {
          // An id of another Stage or Organization is refused the same way.
          if (!input.ids.every((id) => statuses.some((s) => s.id === id))) {
            throw notFound("Quote Status")
          }
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "List every Quote Status of the Stage exactly once.",
          })
        }
        for (const [sequence, id] of input.ids.entries()) {
          const current = inStage.find((s) => s.id === id)!
          if (current.sequence !== sequence) {
            await scope.update(quoteStatuses, id, {
              sequence,
              updatedAt: new Date(),
            })
          }
        }
        return input.ids.map((id, sequence) =>
          view({ ...inStage.find((s) => s.id === id)!, sequence })
        )
      })
    ),

  /**
   * Deletes a Status. The last Status of a Stage can't be deleted
   * (PRECONDITION_FAILED). If Quotes sit on it, `replacementId` (another
   * Status of the same Stage; another Stage → BAD_REQUEST) is required and
   * those Quotes move to it in the same transaction, without Approval Steps.
   * Returns how many Quotes moved.
   */
  deleteQuoteStatus: manageSettings
    .input(z.object({ id: z.uuid(), replacementId: z.uuid().optional() }))
    .mutation(({ ctx, input }) =>
      ctx.scope.transaction(async (scope) => {
        const statuses = await lockStatuses(scope)
        const status = statuses.find((s) => s.id === input.id)
        if (!status) throw notFound("Quote Status")
        const replacement = input.replacementId
          ? statuses.find((s) => s.id === input.replacementId)
          : null
        if (input.replacementId && !replacement) {
          throw notFound("Replacement Quote Status")
        }
        const quoteCount = await quotesOnStatus(scope, status.id)
        const allowed = canDeleteQuoteStatus({
          status,
          countInStage: statuses.filter((s) => s.stage === status.stage).length,
          quoteCount,
          replacement,
        })
        if (!allowed.ok) throw refusal(allowed)

        let moved = 0
        if (replacement) {
          const rows = await scope.db
            .update(quotes)
            .set({ statusId: replacement.id })
            .where(scope.where(quotes, eq(quotes.statusId, status.id)))
            .returning({ id: quotes.id })
          moved = rows.length
        }
        await scope.delete(quoteStatuses, status.id)
        return { id: status.id, replacementId: replacement?.id ?? null, moved }
      })
    ),
}
