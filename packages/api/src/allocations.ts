/**
 * Writing Allocations (the Resource Planner's per-period Effort) inside a
 * Quote command. The domain (`@workspace/domain/allocations`,
 * `@workspace/domain/schedule`) decides what a line's Allocations, quantity
 * and dates become; these helpers persist that result so the three never
 * drift (for a planner-managed line, quantity = Σ Allocations):
 *
 * - `writeAllocations(scope, { lineItemId, timePeriod, before, after })`
 *   upserts and deletes only the cells that changed (`diffAllocations`);
 * - `writeSchedule(scope, { timePeriod, lines, before })` persists a
 *   rescheduling result (`changeQuoteDates` / `changeLineItemStart` /
 *   `applyAllocationEdits`): every changed line's dates and quantity plus
 *   its Allocations.
 *
 * Allocations exist only on Resource Role lines; the callers check that.
 */
import { eq, inArray, schema, sql } from "@workspace/db"
import type { OrganizationScope } from "@workspace/db"
import { diffAllocations } from "@workspace/domain/allocations"
import type { Allocation, AllocationInput } from "@workspace/domain/allocations"
import { periodTypeForTimePeriod } from "@workspace/domain/dates"
import type { IsoDate } from "@workspace/domain/dates"
import type { TimePeriod } from "@workspace/domain/enums"

const { allocations, lineItems } = schema

/** Moves one line's stored Allocations from `before` to `after` (changed cells only). */
export async function writeAllocations(
  scope: OrganizationScope,
  {
    lineItemId,
    timePeriod,
    before,
    after,
  }: {
    lineItemId: string
    timePeriod: TimePeriod
    before: readonly AllocationInput[]
    after: readonly AllocationInput[]
  }
): Promise<void> {
  const periodType = periodTypeForTimePeriod(timePeriod)
  const diff = diffAllocations(timePeriod, before, after)
  if (diff.deletes.length > 0) {
    await scope.db
      .delete(allocations)
      .where(
        scope.where(
          allocations,
          eq(allocations.lineItemId, lineItemId),
          inArray(allocations.periodStart, diff.deletes)
        )
      )
  }
  if (diff.upserts.length > 0) {
    await scope.db
      .insert(allocations)
      .values(
        diff.upserts.map((a) => ({
          organizationId: scope.organizationId,
          lineItemId,
          periodType,
          periodStart: a.periodStart,
          amount: a.amount,
        }))
      )
      .onConflictDoUpdate({
        target: [
          allocations.organizationId,
          allocations.lineItemId,
          allocations.periodType,
          allocations.periodStart,
        ],
        set: { amount: sql`excluded.amount`, updatedAt: new Date() },
      })
  }
}

/** A line's new schedule, as the domain returns it. */
export interface ScheduleWrite {
  id: string
  startDate: IsoDate
  endDate: IsoDate
  quantity: string
  allocations: readonly Allocation[]
  /** False when nothing changed (skipped). Defaults to true. */
  changed?: boolean
}

/**
 * Persists each changed line's dates, quantity and Allocations. `before`
 * holds the lines' stored Allocations (missing = none). Returns the ids
 * written.
 */
export async function writeSchedule(
  scope: OrganizationScope,
  {
    timePeriod,
    lines,
    before,
  }: {
    timePeriod: TimePeriod
    lines: readonly ScheduleWrite[]
    before: ReadonlyMap<string, readonly AllocationInput[]>
  }
): Promise<string[]> {
  const written: string[] = []
  for (const line of lines) {
    if (line.changed === false) continue
    await writeAllocations(scope, {
      lineItemId: line.id,
      timePeriod,
      before: before.get(line.id) ?? [],
      after: line.allocations,
    })
    await scope.update(lineItems, line.id, {
      startDate: line.startDate,
      endDate: line.endDate,
      quantity: line.quantity,
    })
    written.push(line.id)
  }
  return written
}
