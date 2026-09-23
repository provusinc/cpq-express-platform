/**
 * The Quote's schedule commands, spread into the `quote` router:
 * `quote.setDates` (Quote Shift or clamp, with a preview) and
 * `quote.setTimePeriod` (discards every Allocation).
 */
import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { eq, inArray, schema } from "@workspace/db"
import { changeQuoteWindow } from "@workspace/domain/schedule"
import type { ScheduleLine } from "@workspace/domain/schedule"
import { TIME_PERIODS } from "@workspace/domain/enums"

import { writeSchedule } from "../allocations"
import { isoDateInput } from "../inputs"
import { allocationsByLine, editorResult } from "../line-items"
import { quoteCommand } from "../quotes"
import { getOrganizationSettings } from "../settings"
import { organizationProcedure } from "../trpc"

const { allocations, lineItems } = schema

export const quoteScheduleProcedures = {
  /**
   * Moves the Quote Start and/or End Date with the domain's
   * `changeQuoteWindow`: a start move is a Quote Shift by default (every
   * Line Item, its Allocations and the End Date slide by the same delta,
   * keeping all Effort) or, with `mode: "clamp"`, cuts early work; then the
   * End Date moves to `endDate` (inward clamps overrunning lines and trims
   * their Allocations, outward changes nothing else). Refusals (end before
   * start, a bound moved past a whole line) are BAD_REQUEST.
   *
   * `preview: true` returns the impact summary (impacted, clamped,
   * effort-reduced lines and old → new Total, priced from the resulting
   * lines) without writing anything. Applying writes it all in this one
   * command and returns the standard editor result plus the new dates and
   * the impact.
   */
  setDates: organizationProcedure
    .input(
      z.object({
        id: z.uuid(),
        startDate: isoDateInput,
        endDate: isoDateInput,
        mode: z.enum(["shift", "clamp"]).default("shift"),
        preview: z.boolean().default(false),
      })
    )
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.id, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        const [lines, settings] = await Promise.all([
          scope.findMany(lineItems, { where: eq(lineItems.quoteId, quote.id) }),
          getOrganizationSettings(scope),
        ])
        const stored = await allocationsByLine(
          scope,
          lines.map((l) => l.id)
        )
        const scheduleLines: ScheduleLine[] = lines.map((l) => ({
          ...l,
          allocations: stored.get(l.id) ?? [],
        }))
        const result = changeQuoteWindow({
          quote: {
            startDate: quote.startDate,
            endDate: quote.endDate,
            timePeriod: quote.timePeriod,
            hoursPerDay: settings.hoursPerDay,
            currency: quote.currencyCode,
            discount:
              quote.discountKind && quote.discountValue !== null
                ? { kind: quote.discountKind, value: quote.discountValue }
                : null,
          },
          lines: scheduleLines,
          startDate: input.startDate,
          endDate: input.endDate,
          mode: input.mode,
        })
        if (!result.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: result.message })
        }
        const dates = { startDate: result.startDate, endDate: result.endDate }
        if (input.preview) {
          return { preview: true as const, ...dates, impact: result.impact }
        }

        const lineIds = await writeSchedule(scope, {
          timePeriod: quote.timePeriod,
          lines: result.lines,
          before: stored,
        })
        const updated = await cmd.update(dates)
        return {
          preview: false as const,
          ...(await editorResult(cmd, { lineIds })),
          ...dates,
          updatedAt: updated.updatedAt,
          impact: result.impact,
        }
      })
    ),

  /**
   * Changes the Quote's Time Period (and so the Planner's bucket). It
   * discards every Allocation on the Quote: the lines keep their quantity
   * and dates and are no longer planner-managed. Returns the standard
   * editor result (the lines that lost Allocations) plus the Time Period
   * and how many Allocations were discarded.
   */
  setTimePeriod: organizationProcedure
    .input(z.object({ id: z.uuid(), timePeriod: z.enum(TIME_PERIODS) }))
    .mutation(({ ctx, input }) =>
      quoteCommand(ctx, input.id, "quote.edit", async (cmd) => {
        const { scope, quote } = cmd
        const lineIds = (
          await scope.findMany(lineItems, {
            where: eq(lineItems.quoteId, quote.id),
          })
        ).map((l) => l.id)
        let discarded: { lineItemId: string }[] = []
        if (input.timePeriod !== quote.timePeriod && lineIds.length > 0) {
          discarded = await scope.db
            .delete(allocations)
            .where(
              scope.where(allocations, inArray(allocations.lineItemId, lineIds))
            )
            .returning({ lineItemId: allocations.lineItemId })
        }
        const updated = await cmd.update({ timePeriod: input.timePeriod })
        return {
          ...(await editorResult(cmd, {
            lineIds: [...new Set(discarded.map((d) => d.lineItemId))],
          })),
          timePeriod: updated.timePeriod,
          updatedAt: updated.updatedAt,
          discardedAllocations: discarded.length,
        }
      })
    ),
}
