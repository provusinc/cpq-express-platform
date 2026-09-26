/**
 * The Quote editor's shared server pieces (ADR-0003): the Line Item shape
 * the grid reads, the standard result every editor command returns, undo
 * snapshots for destructive commands, and the "in use" lookups for Line
 * Item sources.
 *
 * **The standard command result.** Every command that changes what the
 * editor shows (Line Items, the Quote Discount; later Phases, Allocations,
 * dates) returns an `EditorResult`:
 *
 *   { quoteId, lines: LineItemView[], deletedLineIds: string[],
 *     phases: PhaseView[], deletedPhaseIds: string[],
 *     milestones: MilestoneView[], deletedMilestoneIds: string[], totals }
 *
 * - `lines`: the inserted or changed Line Items as now stored, with their
 *   recomputed `lineTotal` / `lineMarginPct` and their Allocations
 *   (`allocations`, by period start; empty unless planner-managed), so a
 *   command that changes Allocations (the Resource Planner, date changes)
 *   returns them on the lines it touched;
 * - `deletedLineIds`: Line Items the command removed;
 * - `phases` / `deletedPhaseIds`: the inserted or changed Phases (a move
 *   returns every sibling it renumbered) and the removed ones;
 * - `milestones` / `deletedMilestoneIds`: the same for Milestones;
 * - `totals`: the Quote's new Subtotal, Quote Discount, Total, cost and
 *   Margin (`QuoteTotalsRow`), always recomputed by the server.
 *
 * The client merges it into the `quote.editor` cache (`useQuoteCommand` in
 * the web app). Build it with `editorResult(cmd, { lineIds, deletedLineIds,
 * phaseIds, deletedPhaseIds, milestoneIds, deletedMilestoneIds })` at the end of a `quoteCommand` body: it
 * reprices the Quote and picks the named rows. Later tickets extend the
 * shape additively rather than inventing another.
 *
 * **Undo.** A destructive command stores what it removed with
 * `saveUndoSnapshot(scope, …)` and returns the id as `undoToken`; its
 * restore command reads it back once with `takeUndoSnapshot` (NOT_FOUND
 * when unknown, used or another Quote's; PRECONDITION_FAILED once expired).
 * Lines (with their Allocations) are captured with `snapshotLines` and put
 * back with `restoreSnapshotLines`, which refuses once the Quote's dates or
 * Time Period changed or a source was deleted. `copyLines` duplicates lines
 * with their Allocations (clone).
 */
import { TRPCError } from "@trpc/server"

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  lt,
  schema,
  sql,
  uuidv7,
} from "@workspace/db"
import type { OrganizationScope, QuoteTotalsRow } from "@workspace/db"
import type { Allocation } from "@workspace/domain/allocations"

import type { IsoDate } from "@workspace/domain/dates"
import type { TimePeriod } from "@workspace/domain/enums"

import type { InUseCounts } from "./errors"
import { IN_USE_EXAMPLE_LIMIT, notFound } from "./errors"
import type { QuoteCommand, QuoteRow } from "./quotes"

const {
  allocations,
  catalogItems,
  lineItems,
  milestones,
  phases,
  quotes,
  resourceRoles,
  undoSnapshots,
} = schema

type LineItemRow = typeof lineItems.$inferSelect
type AllocationRow = typeof allocations.$inferSelect
type PhaseRow = typeof phases.$inferSelect
type MilestoneRow = typeof milestones.$inferSelect

/** A Milestone as the editor reads it. */
export type MilestoneView = Omit<MilestoneRow, "organizationId" | "createdAt">

export function toMilestoneView(row: MilestoneRow): MilestoneView {
  return omit(row, "organizationId", "createdAt")
}

/** A Phase as the editor reads it. */
export type PhaseView = Pick<PhaseRow, "id" | "parentId" | "name" | "sequence">

export function toPhaseView(row: PhaseRow): PhaseView {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    sequence: row.sequence,
  }
}

/** A Line Item as the editor reads it. */
export type LineItemView = Omit<LineItemRow, "organizationId" | "createdAt"> & {
  /**
   * The line has Allocations, so the Resource Planner owns its quantity
   * (Σ Allocations) and dates; the grid still edits them through the
   * domain's allocation-aware rules.
   */
  plannerManaged: boolean
  /**
   * Its Allocations in the Quote's current bucket, by period start
   * (`amount` at quantity scale). Empty when not planner-managed.
   */
  allocations: Allocation[]
  /**
   * The line's Catalog Type, reached through its Catalog Item (null for a
   * Resource Role line). Names and colours come from `catalogType.list`.
   */
  catalogTypeId: string | null
}

/** What every editor command returns (see the module comment). */
export interface EditorResult {
  quoteId: string
  lines: LineItemView[]
  deletedLineIds: string[]
  phases: PhaseView[]
  deletedPhaseIds: string[]
  milestones: MilestoneView[]
  deletedMilestoneIds: string[]
  totals: QuoteTotalsRow
}

export function toLineItemView(
  row: LineItemRow,
  lineAllocations: readonly Allocation[],
  catalogTypeId: string | null
): LineItemView {
  return {
    ...omit(row, "organizationId", "createdAt"),
    plannerManaged: lineAllocations.length > 0,
    allocations: [...lineAllocations],
    catalogTypeId,
  }
}

/** The Catalog Type of each of `catalogItemIds`. */
export async function catalogTypeIdsByItem(
  scope: OrganizationScope,
  catalogItemIds: readonly string[]
): Promise<Map<string, string>> {
  const ids = [...new Set(catalogItemIds)]
  if (ids.length === 0) return new Map()
  const rows = await scope.db
    .select({ id: catalogItems.id, catalogTypeId: catalogItems.catalogTypeId })
    .from(catalogItems)
    .where(scope.where(catalogItems, inArray(catalogItems.id, ids)))
  return new Map(rows.map((r) => [r.id, r.catalogTypeId]))
}

/** A copy of `value` without `keys`. */
export function omit<T extends object, K extends keyof T>(
  value: T,
  ...keys: K[]
): Omit<T, K> {
  const copy = { ...value }
  for (const key of keys) delete copy[key]
  return copy
}

/** The ids among `lineIds` that have Allocations. */
export async function plannerManagedIds(
  scope: OrganizationScope,
  lineIds: string[]
): Promise<Set<string>> {
  if (lineIds.length === 0) return new Set()
  const rows = await scope.db
    .selectDistinct({ id: allocations.lineItemId })
    .from(allocations)
    .where(scope.where(allocations, inArray(allocations.lineItemId, lineIds)))
  return new Set(rows.map((r) => r.id))
}

/** The stored Allocations of `lineIds`, grouped by line, by period start. */
export async function allocationsByLine(
  scope: OrganizationScope,
  lineIds: readonly string[]
): Promise<Map<string, Allocation[]>> {
  const byLine = new Map<string, Allocation[]>()
  if (lineIds.length === 0) return byLine
  const rows = await scope.db
    .select({
      lineItemId: allocations.lineItemId,
      periodStart: allocations.periodStart,
      amount: allocations.amount,
    })
    .from(allocations)
    .where(
      scope.where(allocations, inArray(allocations.lineItemId, [...lineIds]))
    )
    .orderBy(asc(allocations.lineItemId), asc(allocations.periodStart))
  for (const row of rows) {
    const list = byLine.get(row.lineItemId) ?? []
    list.push({ periodStart: row.periodStart, amount: row.amount })
    byLine.set(row.lineItemId, list)
  }
  return byLine
}

/**
 * Views of `rows`, with their Allocations (and so `plannerManaged`) and
 * Catalog Types looked up.
 */
export async function lineItemViews(
  scope: OrganizationScope,
  rows: LineItemRow[]
): Promise<LineItemView[]> {
  const [byLine, typeByItem] = await Promise.all([
    allocationsByLine(
      scope,
      rows.map((r) => r.id)
    ),
    catalogTypeIdsByItem(
      scope,
      rows.flatMap((r) => (r.catalogItemId ? [r.catalogItemId] : []))
    ),
  ])
  return rows.map((row) =>
    toLineItemView(
      row,
      byLine.get(row.id) ?? [],
      row.catalogItemId ? (typeByItem.get(row.catalogItemId) ?? null) : null
    )
  )
}

/**
 * Reprices the Quote (`cmd.reprice()`) and returns the standard result with
 * the lines named in `lineIds` and the Phases named in `phaseIds`
 * (inserted or changed) as now stored.
 */
export async function editorResult(
  cmd: QuoteCommand,
  {
    lineIds = [],
    deletedLineIds = [],
    phaseIds = [],
    deletedPhaseIds = [],
    milestoneIds = [],
    deletedMilestoneIds = [],
  }: {
    lineIds?: readonly string[]
    deletedLineIds?: readonly string[]
    phaseIds?: readonly string[]
    deletedPhaseIds?: readonly string[]
    milestoneIds?: readonly string[]
    deletedMilestoneIds?: readonly string[]
  }
): Promise<EditorResult> {
  const { totals, lines } = await cmd.reprice()
  const wanted = new Set(lineIds)
  const phaseRows = phaseIds.length
    ? await cmd.scope.findMany(phases, {
        where: and(
          eq(phases.quoteId, cmd.quote.id),
          inArray(phases.id, [...new Set(phaseIds)])
        ),
        orderBy: [asc(phases.sequence), asc(phases.id)],
      })
    : []
  const milestoneRows = milestoneIds.length
    ? await quoteMilestones(cmd.scope, cmd.quote.id, milestoneIds)
    : []
  return {
    quoteId: cmd.quote.id,
    lines: await lineItemViews(
      cmd.scope,
      lines.filter((line) => wanted.has(line.id))
    ),
    deletedLineIds: [...deletedLineIds],
    phases: phaseRows.map(toPhaseView),
    deletedPhaseIds: [...deletedPhaseIds],
    milestones: milestoneRows.map(toMilestoneView),
    deletedMilestoneIds: [...deletedMilestoneIds],
    totals,
  }
}

/** The Quote's Phases, in sibling order. */
export function quotePhases(scope: OrganizationScope, quoteId: string) {
  return scope.findMany(phases, {
    where: eq(phases.quoteId, quoteId),
    orderBy: [asc(phases.sequence), asc(phases.id)],
  })
}

/** The Quote's Milestones by date (only `ids`, when given). */
export function quoteMilestones(
  scope: OrganizationScope,
  quoteId: string,
  ids?: readonly string[]
) {
  return scope.findMany(milestones, {
    where: ids
      ? and(eq(milestones.quoteId, quoteId), inArray(milestones.id, [...ids]))
      : eq(milestones.quoteId, quoteId),
    orderBy: [asc(milestones.date), asc(milestones.id)],
  })
}

/** Every Line Item of the Quote, by sequence. */
export function quoteLineRows(scope: OrganizationScope, quoteId: string) {
  return scope.findMany(lineItems, {
    where: eq(lineItems.quoteId, quoteId),
    orderBy: [asc(lineItems.sequence), asc(lineItems.id)],
  })
}

/** What a delete keeps so its restore can put the lines back. */
export interface LinesSnapshot {
  /** The Quote's window and Time Period at delete time; restore needs them unchanged. */
  quote: { startDate: IsoDate; endDate: IsoDate; timePeriod: TimePeriod }
  lines: Array<Omit<LineItemRow, "createdAt" | "updatedAt">>
  allocations: Array<Omit<AllocationRow, "createdAt" | "updatedAt">>
}

/** Captures `lines` and their Allocations for an undo snapshot. */
export async function snapshotLines(
  scope: OrganizationScope,
  quote: QuoteRow,
  lines: readonly LineItemRow[]
): Promise<LinesSnapshot> {
  const ids = lines.map((l) => l.id)
  const stored = ids.length
    ? await scope.findMany(allocations, {
        where: inArray(allocations.lineItemId, ids),
      })
    : []
  return {
    quote: {
      startDate: quote.startDate,
      endDate: quote.endDate,
      timePeriod: quote.timePeriod,
    },
    lines: lines.map((l) => omit(l, "createdAt", "updatedAt")),
    allocations: stored.map((a) => omit(a, "createdAt", "updatedAt")),
  }
}

/**
 * Re-inserts a snapshot's lines (same ids, Base Rates, prices and
 * Allocations), each in the Phase `phaseFor(line)` gives. PRECONDITION_FAILED
 * when the Quote's dates or Time Period changed since, or a source was
 * deleted. Returns the restored rows.
 */
export async function restoreSnapshotLines(
  scope: OrganizationScope,
  quote: QuoteRow,
  snapshot: LinesSnapshot,
  phaseFor: (line: LinesSnapshot["lines"][number]) => string | null
): Promise<LineItemRow[]> {
  if (
    snapshot.quote.startDate !== quote.startDate ||
    snapshot.quote.endDate !== quote.endDate ||
    snapshot.quote.timePeriod !== quote.timePeriod
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The Quote's dates or Time Period changed since, so the delete can't be undone.",
    })
  }
  const catalogIds = [
    ...new Set(snapshot.lines.flatMap((l) => l.catalogItemId ?? [])),
  ]
  const roleIds = [
    ...new Set(snapshot.lines.flatMap((l) => l.resourceRoleId ?? [])),
  ]
  const [catalog, roles] = await Promise.all([
    catalogIds.length
      ? scope.findMany(catalogItems, {
          where: inArray(catalogItems.id, catalogIds),
        })
      : [],
    roleIds.length
      ? scope.findMany(resourceRoles, {
          where: inArray(resourceRoles.id, roleIds),
        })
      : [],
  ])
  if (catalog.length !== catalogIds.length || roles.length !== roleIds.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "An item on these lines was deleted since, so the delete can't be undone.",
    })
  }
  const restored = await scope.insertMany(
    lineItems,
    snapshot.lines.map((line) => ({
      ...omit(line, "organizationId"),
      phaseId: phaseFor(line),
    }))
  )
  await scope.insertMany(
    allocations,
    snapshot.allocations.map((a) => omit(a, "organizationId"))
  )
  return restored
}

/**
 * What `copyLines` sets on each copy: its Phase and sequence, and
 * optionally another Quote (Quote clone) and re-snapshotted rates.
 */
export type LineCopyPlacement = {
  phaseId: string | null
  sequence: number
} & Partial<
  Pick<
    typeof lineItems.$inferInsert,
    "quoteId" | "basePrice" | "baseCost" | "unitPrice" | "unitCost"
  >
>

/**
 * Copies `lines` with their Allocations under new ids; `place(line)` gives
 * each copy's Phase and sequence (and optionally its Quote and rates, see
 * `LineCopyPlacement`). Returns the copies in the same order.
 */
export async function copyLines(
  scope: OrganizationScope,
  lines: readonly LineItemRow[],
  place: (line: LineItemRow) => LineCopyPlacement
): Promise<LineItemRow[]> {
  if (lines.length === 0) return []
  const newIds = new Map(lines.map((l) => [l.id, uuidv7()]))
  const copies = await scope.insertMany(
    lineItems,
    lines.map((line) => ({
      ...omit(line, "organizationId", "createdAt", "updatedAt"),
      id: newIds.get(line.id)!,
      ...place(line),
    }))
  )
  const stored = await scope.findMany(allocations, {
    where: inArray(
      allocations.lineItemId,
      lines.map((l) => l.id)
    ),
  })
  await scope.insertMany(
    allocations,
    stored.map((a) => ({
      lineItemId: newIds.get(a.lineItemId)!,
      periodType: a.periodType,
      periodStart: a.periodStart,
      amount: a.amount,
    }))
  )
  return copies
}

/** The next free `sequence` on the Quote (appends after every line). */
export async function nextLineSequence(
  scope: OrganizationScope,
  quoteId: string
): Promise<number> {
  const [row] = await scope.db
    .select({ max: sql<number | null>`max(${lineItems.sequence})` })
    .from(lineItems)
    .where(scope.where(lineItems, eq(lineItems.quoteId, quoteId)))
  return row?.max === null || row?.max === undefined ? 0 : Number(row.max) + 1
}

/** How long an undo stays available. */
export const UNDO_TTL_MS = 10 * 60 * 1000

/**
 * Stores what a destructive command removed and returns the undo token
 * (the snapshot's id) and when it expires. Expired snapshots of the
 * Organization are purged on the way.
 */
export async function saveUndoSnapshot(
  scope: OrganizationScope,
  snapshot: { quoteId: string; kind: string; payload: unknown; userId: string }
): Promise<{ undoToken: string; undoExpiresAt: Date }> {
  const now = new Date()
  await scope.db
    .delete(undoSnapshots)
    .where(scope.where(undoSnapshots, lt(undoSnapshots.expiresAt, now)))
  const row = await scope.insert(undoSnapshots, {
    id: uuidv7(),
    quoteId: snapshot.quoteId,
    kind: snapshot.kind,
    payload: snapshot.payload,
    createdById: snapshot.userId,
    expiresAt: new Date(now.getTime() + UNDO_TTL_MS),
  })
  return { undoToken: row.id, undoExpiresAt: row.expiresAt }
}

/**
 * Takes (reads and deletes) the undo snapshot `token` of `kind` on
 * `quoteId`. NOT_FOUND when unknown, already used, or another Quote's;
 * PRECONDITION_FAILED once it has expired.
 */
export async function takeUndoSnapshot<T>(
  scope: OrganizationScope,
  { token, quoteId, kind }: { token: string; quoteId: string; kind: string }
): Promise<T> {
  const [row] = await scope.db
    .delete(undoSnapshots)
    .where(
      scope.where(
        undoSnapshots,
        eq(undoSnapshots.id, token),
        eq(undoSnapshots.quoteId, quoteId),
        eq(undoSnapshots.kind, kind)
      )
    )
    .returning()
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "There is nothing to undo.",
    })
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "It's too late to undo that.",
    })
  }
  return row.payload as T
}

/**
 * What references a Catalog Item or Resource Role through Line Items:
 * counts of Line Items and of distinct Quotes, and the newest Quote names
 * as examples. Backs the "in use" error on delete (the database RESTRICTs
 * it too).
 */
export async function lineItemSourceUsage(
  scope: OrganizationScope,
  column: typeof lineItems.catalogItemId | typeof lineItems.resourceRoleId,
  sourceId: string
): Promise<{ counts: InUseCounts; examples: string[] }> {
  const rows = await scope.db
    .select({ name: quotes.name, lines: count(lineItems.id) })
    .from(lineItems)
    .innerJoin(
      quotes,
      and(
        eq(quotes.organizationId, lineItems.organizationId),
        eq(quotes.id, lineItems.quoteId)
      )
    )
    .where(scope.where(lineItems, eq(column, sourceId)))
    .groupBy(quotes.id, quotes.name, quotes.createdAt)
    .orderBy(desc(quotes.createdAt), desc(quotes.id))
  if (rows.length === 0) return { counts: {}, examples: [] }
  return {
    counts: {
      quotes: rows.length,
      lineItems: rows.reduce((n, r) => n + Number(r.lines), 0),
    },
    examples: rows.slice(0, IN_USE_EXAMPLE_LIMIT).map((r) => r.name),
  }
}

/** NOT_FOUND unless every id in `ids` is a Line Item of `quoteId`. */
export async function findQuoteLines(
  scope: OrganizationScope,
  quoteId: string,
  ids: readonly string[]
): Promise<LineItemRow[]> {
  const unique = [...new Set(ids)]
  const rows = await scope.findMany(lineItems, {
    where: and(eq(lineItems.quoteId, quoteId), inArray(lineItems.id, unique)),
    orderBy: [asc(lineItems.sequence), asc(lineItems.id)],
  })
  if (rows.length !== unique.length) throw notFound("Line Item")
  return rows
}
