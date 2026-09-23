import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { and, eq, inArray, schema } from "@workspace/db"
import {
  applyAllocationEdits,
  defaultAllocations,
} from "@workspace/domain/allocations"
import type { Allocation } from "@workspace/domain/allocations"
import type { IsoDate } from "@workspace/domain/dates"
import type { TimePeriod } from "@workspace/domain/enums"
import { Decimal } from "@workspace/domain/money"

import { writeSchedule } from "../allocations"
import { isoDateInput } from "../inputs"
import {
  allocationsByLine,
  editorResult,
  findQuoteLines,
  saveUndoSnapshot,
  takeUndoSnapshot,
} from "../line-items"
import { quoteCommand } from "../quotes"
import { createTRPCRouter, organizationProcedure } from "../trpc"

const { lineItems } = schema

/** The most cells one planner gesture may set (e.g. 200 lines × 50 weeks). */
export const ALLOCATION_BATCH_MAX = 10_000

/** Undo snapshot kind written by `allocation.setRange`. */
const SET_RANGE_UNDO_KIND = "allocations.set_range"

/** What `allocation.setRange` keeps so `allocation.restore` can put it back. */
interface SetRangeSnapshot {
  quote: { startDate: IsoDate; endDate: IsoDate; timePeriod: TimePeriod }
  lines: Array<{
    id: string
    startDate: IsoDate
    endDate: IsoDate
    quantity: string
    allocations: Allocation[]
  }>
}

/** A planner cell amount as typed: a plain non-negative decimal, at most 3 dp. */
const AMOUNT_PATTERN = /^\d{1,15}(\.\d{1,3})?$/
const amountInput = z
  .union([z.string().trim(), z.number()])
  .refine(
    (v) =>
      AMOUNT_PATTERN.test(
        typeof v === "number"
          ? Number.isFinite(v)
            ? new Decimal(v).toFixed()
            : ""
          : v
      ),
    { message: "Enter a number of 0 or more with up to 3 decimals." }
  )
  .transform((v) => new Decimal(v).toFixed())

const setRangeInput = z.object({
  quoteId: z.uuid(),
  cells: z
    .array(
      z.object({
        lineItemId: z.uuid(),
        /** Any day of the bucket; normalised to its first day. */
        periodStart: isoDateInput,
        /** Hours for the cell; `null` or 0 clears it. */
        amount: amountInput.nullable(),
      })
    )
    .min(1)
    .max(ALLOCATION_BATCH_MAX),
})

export const allocationRouter = createTRPCRouter({
  /**
   * One Resource Planner gesture (typing a cell, filling a range, drag-fill,
   * filling or clearing a row) as one batched command. Cells are grouped by
   * line and applied with the domain's `applyAllocationEdits`: per-cell
   * caps (168 h a week, 744 a month, 2,160 a quarter), buckets overlapping
   * the Quote dates, periods normalised to their bucket's first day, one
   * Allocation per (line, period type, period start). Only Resource Role
   * lines take Allocations (BAD_REQUEST otherwise). If any cell is refused,
   * nothing is written (BAD_REQUEST with that cell's message).
   *
   * A line the Planner touches for the first time (no Allocations yet) is
   * first laid out with `defaultAllocations` — what the Planner shows for
   * it — so untouched periods keep their share. Afterwards each touched
   * line's quantity is Σ Allocations and its dates follow them. Returns the
   * standard editor result (the touched lines carry their `allocations`)
   * and an `undoToken` for `allocation.restore`.
   */
  setRange: organizationProcedure
    .input(setRangeInput)
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        const lines = await findQuoteLines(
          scope,
          quote.id,
          input.cells.map((c) => c.lineItemId)
        )
        const notRole = lines.find((l) => l.sourceKind !== "resource_role")
        if (notRole) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `“${notRole.name}” isn't a Resource Role line, so it can't have Allocations.`,
          })
        }
        const stored = await allocationsByLine(
          scope,
          lines.map((l) => l.id)
        )

        const results = lines.map((line) => {
          const current =
            stored.get(line.id) ??
            defaultAllocations({
              timePeriod: quote.timePeriod,
              billingUnit: line.billingUnit,
              quantity: line.quantity,
              startDate: line.startDate,
              endDate: line.endDate,
            })
          const result = applyAllocationEdits({
            timePeriod: quote.timePeriod,
            billingUnit: line.billingUnit,
            line: { ...line, allocations: current },
            quote,
            edits: input.cells
              .filter((c) => c.lineItemId === line.id)
              .map((c) => ({
                periodStart: c.periodStart,
                amount: c.amount ?? 0,
              })),
          })
          return { line, result }
        })

        const refused = results.flatMap(({ line, result }) =>
          result.ok ? [] : result.errors.map((e) => ({ line, ...e }))
        )
        if (refused.length > 0) {
          const first = refused[0]!
          const more =
            refused.length > 1 ? ` (and ${refused.length - 1} more)` : ""
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${first.line.name}, ${first.periodStart}: ${first.message}${more}`,
          })
        }

        const undo = await saveUndoSnapshot(scope, {
          quoteId: quote.id,
          kind: SET_RANGE_UNDO_KIND,
          userId: cmd.actor.userId,
          payload: {
            quote: {
              startDate: quote.startDate,
              endDate: quote.endDate,
              timePeriod: quote.timePeriod,
            },
            lines: lines.map((l) => ({
              id: l.id,
              startDate: l.startDate,
              endDate: l.endDate,
              quantity: l.quantity,
              allocations: stored.get(l.id) ?? [],
            })),
          } satisfies SetRangeSnapshot,
        })

        await writeSchedule(scope, {
          timePeriod: quote.timePeriod,
          before: stored,
          lines: results.map(({ line, result }) => ({
            id: line.id,
            ...(result as Extract<typeof result, { ok: true }>),
          })),
        })
        return {
          ...(await editorResult(cmd, { lineIds: lines.map((l) => l.id) })),
          ...undo,
        }
      })
    ),

  /**
   * Undoes an `allocation.setRange` (e.g. "clear row"): puts the touched
   * lines' Allocations, quantity and dates back as they were, once.
   * Refused (PRECONDITION_FAILED) after the Quote's dates or Time Period
   * changed or once one of the lines was deleted; NOT_FOUND for an unknown
   * or used token.
   */
  restore: organizationProcedure
    .input(z.object({ quoteId: z.uuid(), undoToken: z.uuid() }))
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.quoteId, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        const snapshot = await takeUndoSnapshot<SetRangeSnapshot>(scope, {
          token: input.undoToken,
          quoteId: quote.id,
          kind: SET_RANGE_UNDO_KIND,
        })
        if (
          snapshot.quote.startDate !== quote.startDate ||
          snapshot.quote.endDate !== quote.endDate ||
          snapshot.quote.timePeriod !== quote.timePeriod
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "The Quote's dates or Time Period changed since, so this can't be undone.",
          })
        }
        const ids = snapshot.lines.map((l) => l.id)
        const live = await scope.findMany(lineItems, {
          where: and(
            eq(lineItems.quoteId, quote.id),
            inArray(lineItems.id, ids)
          ),
        })
        if (live.length !== ids.length) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "A line was deleted since, so this can't be undone.",
          })
        }
        await writeSchedule(scope, {
          timePeriod: quote.timePeriod,
          before: await allocationsByLine(scope, ids),
          lines: snapshot.lines,
        })
        return editorResult(cmd, { lineIds: ids })
      })
    ),
})
