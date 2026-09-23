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
 *   { quoteId, lines: LineItemView[], deletedLineIds: string[], totals }
 *
 * - `lines`: the inserted or changed Line Items as now stored, with their
 *   recomputed `lineTotal` / `lineMarginPct` and their Allocations
 *   (`allocations`, by period start; empty unless planner-managed), so a
 *   command that changes Allocations (the Resource Planner, date changes)
 *   returns them on the lines it touched;
 * - `deletedLineIds`: Line Items the command removed;
 * - `totals`: the Quote's new Subtotal, Quote Discount, Total, cost and
 *   Margin (`QuoteTotalsRow`), always recomputed by the server.
 *
 * The client merges it into the `quote.editor` cache (`useQuoteCommand` in
 * the web app). Build it with `editorResult(cmd, { lineIds, deletedLineIds })`
 * at the end of a `quoteCommand` body: it reprices the Quote and picks the
 * named lines. Later tickets extend the shape additively (e.g. `phases` /
 * `deletedPhaseIds` for #14) rather than inventing another.
 *
 * **Undo.** A destructive command stores what it removed with
 * `saveUndoSnapshot(scope, …)` and returns the id as `undoToken`; its
 * restore command reads it back once with `takeUndoSnapshot` (NOT_FOUND
 * when unknown, used or another Quote's; PRECONDITION_FAILED once expired).
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

import type { InUseCounts } from "./errors"
import { IN_USE_EXAMPLE_LIMIT, notFound } from "./errors"
import type { QuoteCommand } from "./quotes"

const { allocations, lineItems, quotes, undoSnapshots } = schema

type LineItemRow = typeof lineItems.$inferSelect

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
}

/** What every editor command returns (see the module comment). */
export interface EditorResult {
  quoteId: string
  lines: LineItemView[]
  deletedLineIds: string[]
  totals: QuoteTotalsRow
}

export function toLineItemView(
  row: LineItemRow,
  lineAllocations: readonly Allocation[]
): LineItemView {
  return {
    ...omit(row, "organizationId", "createdAt"),
    plannerManaged: lineAllocations.length > 0,
    allocations: [...lineAllocations],
  }
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

/** Views of `rows`, with their Allocations (and so `plannerManaged`) looked up. */
export async function lineItemViews(
  scope: OrganizationScope,
  rows: LineItemRow[]
): Promise<LineItemView[]> {
  const byLine = await allocationsByLine(
    scope,
    rows.map((r) => r.id)
  )
  return rows.map((row) => toLineItemView(row, byLine.get(row.id) ?? []))
}

/**
 * Reprices the Quote (`cmd.reprice()`) and returns the standard result with
 * the lines named in `lineIds` (inserted or changed) as now stored.
 */
export async function editorResult(
  cmd: QuoteCommand,
  {
    lineIds = [],
    deletedLineIds = [],
  }: { lineIds?: readonly string[]; deletedLineIds?: readonly string[] }
): Promise<EditorResult> {
  const { totals, lines } = await cmd.reprice()
  const wanted = new Set(lineIds)
  return {
    quoteId: cmd.quote.id,
    lines: await lineItemViews(
      cmd.scope,
      lines.filter((line) => wanted.has(line.id))
    ),
    deletedLineIds: [...deletedLineIds],
    totals,
  }
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
