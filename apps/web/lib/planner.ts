/**
 * Pure helpers behind the Resource Planner grid: its period columns (labels,
 * capacity, the current one, the Phase band row), the Allocations a row
 * shows, Phase grouping, the heat level and presets of a cell, and the
 * spreadsheet maths for range selection, fill and drag-fill. No React here, so it is unit-tested
 * (`planner.test.ts`).
 */
import {
  applyAllocationEdits,
  defaultAllocations,
} from "@workspace/domain/allocations"
import type { Allocation } from "@workspace/domain/allocations"
import {
  countWorkingDays,
  daysBetween,
  endOfPeriod,
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
import { phaseRollups } from "@workspace/domain/phases"
import type { RollupLine } from "@workspace/domain/phases"

// ─── Columns ────────────────────────────────────────────────────────────────

export interface PlannerPeriod {
  /** First day of the bucket. */
  start: IsoDate
  /** Last day of the bucket. */
  end: IsoDate
  /** Short header text: "W41" (ISO week), "Oct", "Q4". */
  label: string
  /** Second header line: a week's first day ("10/5"), else the year. */
  sublabel: string
  /** The period named in full: "W41 · Oct 5", "Oct 2026", "Q4 2026". */
  title: string
  /** Monday–Friday days of the bucket inside the Quote dates. */
  workingDays: number
}

const MONTH = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" })

/** The ISO 8601 week number of a day (weeks start on Monday). */
export function isoWeek(day: IsoDate): number {
  const date = new Date(`${day}T00:00:00Z`)
  // The Thursday of this week decides the week's year.
  date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7))
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  return (
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    )
  )
}

function periodLabel(type: PeriodType, start: IsoDate) {
  const date = new Date(`${start}T00:00:00Z`)
  const year = date.getUTCFullYear()
  const month = MONTH.format(date)
  if (type === "week") {
    const label = `W${isoWeek(start)}`
    return {
      label,
      sublabel: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
      title: `${label} · ${month} ${date.getUTCDate()}`,
    }
  }
  if (type === "month")
    return { label: month, sublabel: `${year}`, title: `${month} ${year}` }
  const label = `Q${Math.floor(date.getUTCMonth() / 3) + 1}`
  return { label, sublabel: `${year}`, title: `${label} ${year}` }
}

/** The Planner's columns: every bucket of the Time Period that the Quote dates touch. */
export function plannerPeriods(
  timePeriod: TimePeriod,
  startDate: IsoDate,
  endDate: IsoDate
): PlannerPeriod[] {
  const type = periodTypeForTimePeriod(timePeriod)
  return periodStartsInRange(type, startDate, endDate).map((start) => {
    const end = endOfPeriod(type, start)
    return {
      start,
      end,
      ...periodLabel(type, start),
      workingDays: countWorkingDays(
        start < startDate ? startDate : start,
        end > endDate ? endDate : end
      ),
    }
  })
}

/** The period containing `today`, or -1 when the Quote dates don't. */
export function currentPeriodIndex(
  periods: readonly PlannerPeriod[],
  today: IsoDate
): number {
  return periods.findIndex((p) => p.start <= today && today <= p.end)
}

/** How a bucket's hours read: "hrs/wk", "hrs/mo", "hrs/qtr". */
export const PER_PERIOD: Record<PeriodType, string> = {
  week: "hrs/wk",
  month: "hrs/mo",
  quarter: "hrs/qtr",
}

/** The one-click amounts for a bucket: a full week down to none, scaled. */
export function bucketPresets(type: PeriodType): number[] {
  const scale = { week: 1, month: 4, quarter: 12 }[type]
  return [40, 20, 12, 8, 4, 0].map((hours) => hours * scale)
}

/** Heat steps of a cell (0 = empty; `HEAT_LEVELS` = over capacity). */
export const HEAT_LEVELS = 5

/**
 * How heavy a cell is against its period's capacity (working days × Hours
 * Per Day): 0 empty, 1–4 by quarters of the capacity, 5 above it (or any
 * hours in a period without working days).
 */
export function heatLevel(
  amount: string | undefined,
  capacityHours: number
): number {
  const hours = amount ? Number(amount) : 0
  if (!(hours > 0)) return 0
  if (!(capacityHours > 0)) return HEAT_LEVELS
  const ratio = hours / capacityHours
  if (ratio > 1) return HEAT_LEVELS
  return Math.max(1, Math.ceil(ratio * 4))
}

/** A top-level Phase across a run of period columns (the band row). */
export interface PhaseBand {
  phaseId: string
  name: string
  /** 1 … `PHASE_TINTS`, by top-level order (as on the Overview). */
  tint: number
  /** First column (index into the periods). */
  start: number
  /** Columns spanned. */
  span: number
}

const PHASE_TINT_COUNT = 5

/**
 * The band row over the period columns: each period goes to the top-level
 * Phase whose date span (its lines', from `phaseRollups`) overlaps it by
 * the most days (the earlier Phase on a tie), and neighbouring periods of
 * one Phase merge into one band. Periods no Phase touches have no band.
 */
export function phaseBands(
  periods: readonly PlannerPeriod[],
  phases: readonly PlannerPhase[],
  lines: readonly RollupLine[]
): PhaseBand[] {
  const rollups = phaseRollups(phases, lines)
  const top = phases
    .filter((p) => p.parentId === null)
    .sort((a, b) => a.sequence - b.sequence)
    .map((phase, index) => ({
      phase,
      tint: (index % PHASE_TINT_COUNT) + 1,
      startDate: rollups[phase.id]?.startDate ?? null,
      endDate: rollups[phase.id]?.endDate ?? null,
    }))
    .filter((p) => p.startDate && p.endDate)
  const bands: PhaseBand[] = []
  periods.forEach((period, col) => {
    let best: (typeof top)[number] | undefined
    let bestDays = 0
    for (const candidate of top) {
      const from =
        candidate.startDate! > period.start
          ? candidate.startDate!
          : period.start
      const to =
        candidate.endDate! < period.end ? candidate.endDate! : period.end
      const days = to < from ? 0 : daysBetween(from, to) + 1
      if (days > bestDays) {
        best = candidate
        bestDays = days
      }
    }
    if (!best) return
    const last = bands.at(-1)
    if (
      last &&
      last.phaseId === best.phase.id &&
      last.start + last.span === col
    )
      last.span++
    else
      bands.push({
        phaseId: best.phase.id,
        name: best.phase.name,
        tint: best.tint,
        start: col,
        span: 1,
      })
  })
  return bands
}

/** The band over column `col`, if any. */
export function bandAt(bands: readonly PhaseBand[], col: number) {
  return bands.find((b) => col >= b.start && col < b.start + b.span)
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

/**
 * What a selection covers, as the Planner's action bar names it: the role
 * (or "3 Resource Roles"), the period (or "W43 – W45" / "Oct 2026 – Dec
 * 2026") and, when given, the Phase of the focused period —
 * "Project Manager · W43 · Oct 19 · Discovery".
 */
export function selectionCaption({
  range,
  rowNames,
  periods,
  periodType,
  rolesWord,
  phase,
}: {
  range: CellRange
  rowNames: readonly string[]
  periods: readonly PlannerPeriod[]
  periodType: PeriodType
  /** The plural of the Resource Role term, for a multi-row selection. */
  rolesWord: string
  phase?: string | null
}): string {
  const rows = range.bottom - range.top + 1
  const first = periods[range.left]
  const last = periods[range.right]
  const who = rows === 1 ? (rowNames[range.top] ?? "") : `${rows} ${rolesWord}`
  const when =
    !first || !last
      ? ""
      : range.left === range.right
        ? first.title
        : periodType === "week"
          ? `${first.label} – ${last.label}`
          : `${first.title} – ${last.title}`
  return [who, when, phase].filter(Boolean).join(" · ")
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
