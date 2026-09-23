/**
 * Pure helpers behind the Resource Planner grid: its period columns, the
 * Allocations a row shows, Phase grouping, and the spreadsheet maths for
 * range selection, fill and drag-fill. No React here, so it is unit-tested
 * (`planner.test.ts`).
 */
import {
  applyAllocationEdits,
  defaultAllocations,
} from "@workspace/domain/allocations"
import type { Allocation } from "@workspace/domain/allocations"
import {
  periodStartsInRange,
  periodTypeForTimePeriod,
} from "@workspace/domain/dates"
import type { IsoDate } from "@workspace/domain/dates"
import type {
  BillingUnit,
  PeriodType,
  TimePeriod,
} from "@workspace/domain/enums"
import { Decimal } from "@workspace/domain/money"

// ─── Columns ────────────────────────────────────────────────────────────────

export interface PlannerPeriod {
  /** First day of the bucket. */
  start: IsoDate
  /** Short header text, e.g. "Oct 5", "Oct 2026", "Q4 2026". */
  label: string
  /** Second header line (the year for weeks), or "". */
  sublabel: string
}

const MONTH = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" })

function periodLabel(type: PeriodType, start: IsoDate) {
  const date = new Date(`${start}T00:00:00Z`)
  const year = date.getUTCFullYear()
  if (type === "week") {
    return {
      label: `${MONTH.format(date)} ${date.getUTCDate()}`,
      sublabel: `${year}`,
    }
  }
  if (type === "month")
    return { label: MONTH.format(date), sublabel: `${year}` }
  return {
    label: `Q${Math.floor(date.getUTCMonth() / 3) + 1}`,
    sublabel: `${year}`,
  }
}

/** The Planner's columns: every bucket of the Time Period that the Quote dates touch. */
export function plannerPeriods(
  timePeriod: TimePeriod,
  startDate: IsoDate,
  endDate: IsoDate
): PlannerPeriod[] {
  const type = periodTypeForTimePeriod(timePeriod)
  return periodStartsInRange(type, startDate, endDate).map((start) => ({
    start,
    ...periodLabel(type, start),
  }))
}

// ─── Rows ───────────────────────────────────────────────────────────────────

/** What the Planner needs of a Line Item. */
export interface PlannerLine {
  id: string
  phaseId: string | null
  sourceKind: string
  billingUnit: BillingUnit
  name: string
  startDate: IsoDate
  endDate: IsoDate
  quantity: string
  plannerManaged: boolean
  allocations: Allocation[]
}

/** Only hourly Resource Role lines appear in the Planner. */
export function isPlannerLine(
  line: Pick<PlannerLine, "sourceKind" | "billingUnit">
) {
  return line.sourceKind === "resource_role" && line.billingUnit === "hour"
}

/**
 * The Allocations a row shows: the stored ones once planner-managed, else
 * the default layout of its quantity over its dates (what the first edit
 * will start from, so what you see is what you edit).
 */
export function shownAllocations(
  line: PlannerLine,
  timePeriod: TimePeriod
): Allocation[] {
  if (line.plannerManaged) return line.allocations
  return defaultAllocations({
    timePeriod,
    billingUnit: line.billingUnit,
    quantity: line.quantity,
    startDate: line.startDate,
    endDate: line.endDate,
  })
}

export interface PlannerPhase {
  id: string
  parentId: string | null
  name: string
  sequence: number
}

export type PlannerRow =
  | {
      kind: "phase"
      id: string
      name: string
      depth: number
      /** Planner lines in this Phase and its sub-Phases. */
      lineIds: string[]
      collapsed: boolean
    }
  | { kind: "line"; id: string; depth: number; line: PlannerLine }

export const NO_PHASE_ID = "__no_phase__"

const bySequence = (a: PlannerPhase, b: PlannerPhase) =>
  a.sequence - b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * The Planner's rows in display order: each Phase (depth first, only those
 * with planner lines somewhere below) as a header row followed by its lines
 * and sub-Phases, then the lines in no Phase under a "No phase" header
 * (shown only when there are Phases at all). A collapsed Phase hides
 * everything below it. `lines` must already be in grid order.
 */
export function plannerRows(
  lines: readonly PlannerLine[],
  phases: readonly PlannerPhase[],
  collapsed: ReadonlySet<string>,
  noPhaseLabel = "No phase"
): PlannerRow[] {
  const known = new Set(phases.map((p) => p.id))
  const children = new Map<string | null, PlannerPhase[]>()
  for (const phase of phases) {
    const parent =
      phase.parentId && known.has(phase.parentId) ? phase.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), phase])
  }
  const linesIn = new Map<string | null, PlannerLine[]>()
  for (const line of lines) {
    const key = line.phaseId && known.has(line.phaseId) ? line.phaseId : null
    linesIn.set(key, [...(linesIn.get(key) ?? []), line])
  }

  const subtreeLines = (id: string): string[] => [
    ...(linesIn.get(id) ?? []).map((l) => l.id),
    ...(children.get(id) ?? [])
      .sort(bySequence)
      .flatMap((c) => subtreeLines(c.id)),
  ]

  const rows: PlannerRow[] = []
  const visit = (phase: PlannerPhase, depth: number) => {
    const lineIds = subtreeLines(phase.id)
    if (lineIds.length === 0) return
    const isCollapsed = collapsed.has(phase.id)
    rows.push({
      kind: "phase",
      id: phase.id,
      name: phase.name,
      depth,
      lineIds,
      collapsed: isCollapsed,
    })
    if (isCollapsed) return
    for (const line of linesIn.get(phase.id) ?? []) {
      rows.push({ kind: "line", id: line.id, depth: depth + 1, line })
    }
    for (const child of (children.get(phase.id) ?? []).sort(bySequence)) {
      visit(child, depth + 1)
    }
  }
  for (const phase of (children.get(null) ?? []).sort(bySequence))
    visit(phase, 0)

  const loose = linesIn.get(null) ?? []
  if (loose.length > 0) {
    const grouped = rows.length > 0 || phases.length > 0
    if (grouped) {
      const isCollapsed = collapsed.has(NO_PHASE_ID)
      rows.push({
        kind: "phase",
        id: NO_PHASE_ID,
        name: noPhaseLabel,
        depth: 0,
        lineIds: loose.map((l) => l.id),
        collapsed: isCollapsed,
      })
      if (isCollapsed) return rows
    }
    for (const line of loose) {
      rows.push({ kind: "line", id: line.id, depth: grouped ? 1 : 0, line })
    }
  }
  return rows
}

// ─── Totals ─────────────────────────────────────────────────────────────────

/** amount by period start. */
export type AmountByPeriod = Map<IsoDate, string>

export function amountsByPeriod(
  allocations: readonly Allocation[]
): AmountByPeriod {
  return new Map(allocations.map((a) => [a.periodStart, a.amount]))
}

/** Σ of decimal strings, as a plain string ("0" when empty). */
export function sumAmounts(amounts: Iterable<string | undefined>): string {
  let total = new Decimal(0)
  for (const a of amounts) if (a) total = total.plus(a)
  return total.toFixed()
}

/** A decimal string for a cell: "40.000" → "40", "7.500" → "7.5", zero → "". */
export function formatAmount(amount: string | undefined): string {
  if (!amount) return ""
  const value = new Decimal(amount)
  return value.isZero() ? "" : value.toFixed()
}

// ─── Selection ──────────────────────────────────────────────────────────────

/** A cell by position among the visible line rows and the period columns. */
export interface CellPos {
  row: number
  col: number
}

export interface CellRange {
  top: number
  left: number
  bottom: number
  right: number
}

export function rangeOf(anchor: CellPos, focus: CellPos): CellRange {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col),
  }
}

export function inRange(range: CellRange | null, row: number, col: number) {
  return (
    range !== null &&
    row >= range.top &&
    row <= range.bottom &&
    col >= range.left &&
    col <= range.right
  )
}

/** `pos` moved by (dRow, dCol), kept inside a rows × cols grid. */
export function movePos(
  pos: CellPos,
  dRow: number,
  dCol: number,
  rows: number,
  cols: number
): CellPos {
  return {
    row: Math.max(0, Math.min(rows - 1, pos.row + dRow)),
    col: Math.max(0, Math.min(cols - 1, pos.col + dCol)),
  }
}

/** One cell to write, as `allocation.setRange` takes it. */
export interface CellEdit {
  lineItemId: string
  periodStart: IsoDate
  /** `null` clears the cell. */
  amount: string | null
}

/** Every cell of `range` set to `amount` (`null` clears). */
export function fillRange(
  range: CellRange,
  lineIds: readonly string[],
  periods: readonly IsoDate[],
  amount: string | null
): CellEdit[] {
  const edits: CellEdit[] = []
  for (let row = range.top; row <= range.bottom; row++) {
    for (let col = range.left; col <= range.right; col++) {
      const lineItemId = lineIds[row]
      const periodStart = periods[col]
      if (lineItemId && periodStart)
        edits.push({ lineItemId, periodStart, amount })
    }
  }
  return edits
}

/**
 * Where a drag-fill from `source` towards `target` lands: the source range
 * extended along the axis the pointer moved furthest (like a spreadsheet's
 * fill handle), or null when the pointer is still inside the source.
 */
export function dragFillRange(
  source: CellRange,
  target: CellPos
): CellRange | null {
  const down = target.row - source.bottom
  const up = source.top - target.row
  const right = target.col - source.right
  const left = source.left - target.col
  const vertical = Math.max(down, up)
  const horizontal = Math.max(right, left)
  if (vertical <= 0 && horizontal <= 0) return null
  if (vertical >= horizontal) {
    return down > 0
      ? { ...source, bottom: target.row }
      : { ...source, top: target.row }
  }
  return right > 0
    ? { ...source, right: target.col }
    : { ...source, left: target.col }
}

/**
 * The cells a drag-fill writes: the part of `extended` outside `source`,
 * repeating the source's values as a tile (so one cell copies its value,
 * and a row of values repeats down the rows).
 */
export function dragFillEdits(
  source: CellRange,
  extended: CellRange,
  lineIds: readonly string[],
  periods: readonly IsoDate[],
  valueAt: (row: number, col: number) => string | undefined
): CellEdit[] {
  const height = source.bottom - source.top + 1
  const width = source.right - source.left + 1
  const mod = (n: number, m: number) => ((n % m) + m) % m
  const edits: CellEdit[] = []
  for (let row = extended.top; row <= extended.bottom; row++) {
    for (let col = extended.left; col <= extended.right; col++) {
      if (inRange(source, row, col)) continue
      const lineItemId = lineIds[row]
      const periodStart = periods[col]
      if (!lineItemId || !periodStart) continue
      const value = valueAt(
        source.top + mod(row - source.top, height),
        source.left + mod(col - source.left, width)
      )
      edits.push({
        lineItemId,
        periodStart,
        amount: value && !new Decimal(value).isZero() ? value : null,
      })
    }
  }
  return edits
}

// ─── Optimistic apply ───────────────────────────────────────────────────────

/**
 * What `allocation.setRange` will do to each touched line, computed in the
 * browser with the same domain rules (for the optimistic update): the new
 * Allocations, quantity and dates by line id. Lines whose edits the domain
 * refuses are left out (the server will refuse the whole gesture).
 */
export function applyEditsLocally<L extends PlannerLine>(
  lines: readonly L[],
  edits: readonly CellEdit[],
  timePeriod: TimePeriod,
  quote: { startDate: IsoDate; endDate: IsoDate }
): Map<string, Partial<L>> {
  const patches = new Map<string, Partial<L>>()
  const byLine = new Map<string, CellEdit[]>()
  for (const edit of edits) {
    byLine.set(edit.lineItemId, [...(byLine.get(edit.lineItemId) ?? []), edit])
  }
  for (const line of lines) {
    const lineEdits = byLine.get(line.id)
    if (!lineEdits) continue
    const result = applyAllocationEdits({
      timePeriod,
      billingUnit: line.billingUnit,
      line: { ...line, allocations: shownAllocations(line, timePeriod) },
      quote,
      edits: lineEdits.map((e) => ({
        periodStart: e.periodStart,
        amount: e.amount ?? 0,
      })),
    })
    if (!result.ok) continue
    patches.set(line.id, {
      allocations: result.allocations,
      plannerManaged: result.allocations.length > 0,
      quantity: result.quantity,
      startDate: result.startDate,
      endDate: result.endDate,
    } as Partial<L>)
  }
  return patches
}
