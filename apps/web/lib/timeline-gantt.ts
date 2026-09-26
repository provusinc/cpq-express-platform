/**
 * The Timeline tab's Gantt data: the tree of rows (the Milestones group,
 * then Phases and Line Items in grid order) and the dates the Gantt draws.
 * The Gantt (ReUI) takes instants with an exclusive end, the Quote ISO
 * `yyyy-MM-dd` days with an inclusive end; it runs in UTC, so a day is its
 * UTC midnight.
 */
import {
  addDays,
  compareDates,
  countWorkingDays,
  daysBetween,
  endOfPeriod,
  periodTypeForTimePeriod,
} from "@workspace/domain/dates"
import type { IsoDate } from "@workspace/domain/dates"
import type { TimePeriod } from "@workspace/domain/enums"
import { phaseTreeOrder } from "@workspace/domain/phases"

import { heatLevel, isPlannerLine, shownAllocations } from "./planner"
import type { PlannerLine } from "./planner"
import { timelineRange } from "./timeline"

/** A day's UTC midnight. */
export const dayStart = (date: IsoDate) => new Date(`${date}T00:00:00Z`)

/** An inclusive day span as the Gantt's half-open instants. */
export function daySpan(startDate: IsoDate, endDate: IsoDate) {
  return { start: dayStart(startDate), end: dayStart(addDays(endDate, 1)) }
}

/** One Gantt row: a Phase (a group) or a Line Item. */
export interface TimelineNode {
  id: string
  title: string
  children?: TimelineNode[]
}

interface PhaseLike {
  id: string
  name: string
  parentId: string | null
  sequence: number
}
interface LineLike {
  id: string
  name: string
  phaseId: string | null
  sequence: number
}
interface MilestoneLike {
  id: string
  date: IsoDate
}

/** A Milestone's line on the chart: where it falls across the range, 0 … 1. */
export interface MilestoneMark<T> {
  milestone: T
  at: number
}

/**
 * Where each Milestone's line goes in the Gantt's visible range (half-open
 * instants): the middle of its day, so the line sits on the day's column.
 * Milestones outside the range are left out; later ones draw on top.
 */
export function milestoneMarks<T extends MilestoneLike>(
  milestones: readonly T[],
  range: { start: Date; end: Date }
): MilestoneMark<T>[] {
  const start = range.start.getTime()
  const span = range.end.getTime() - start
  if (!(span > 0)) return []
  return milestones
    .map((milestone) => ({
      milestone,
      ms: dayStart(milestone.date).getTime() + 12 * 60 * 60 * 1000,
    }))
    .filter(({ ms }) => ms >= start && ms < start + span)
    .sort((a, b) => a.ms - b.ms)
    .map(({ milestone, ms }) => ({ milestone, at: (ms - start) / span }))
}

/**
 * The Gantt's rows: the Phase tree in grid order — a Phase is always a
 * group (empty or not), its Line Items first, then its child Phases.
 * Milestones have no rows: they are lines across the chart
 * (`milestoneMarks`).
 */
export function timelineTree(
  phases: readonly PhaseLike[],
  lines: readonly LineLike[]
): TimelineNode[] {
  const roots: TimelineNode[] = []
  const phaseById = new Map(phases.map((p) => [p.id, p]))
  const lineById = new Map(lines.map((l) => [l.id, l]))
  const groups = new Map<string, TimelineNode[]>()
  for (const row of phaseTreeOrder(phases, lines)) {
    const container =
      row.kind === "phase"
        ? row.parentId
        : phaseById.has(row.phaseId ?? "")
          ? row.phaseId
          : null
    const siblings = (container && groups.get(container)) || roots
    if (row.kind === "phase") {
      const children: TimelineNode[] = []
      groups.set(row.id, children)
      siblings.push({
        id: row.id,
        title: phaseById.get(row.id)!.name,
        children,
      })
    } else {
      siblings.push({ id: row.id, title: lineById.get(row.id)!.name })
    }
  }
  return roots
}

/**
 * The day the Gantt opens on: the middle of the Quote dates widened to
 * every line and Milestone, and the scale that fits that span.
 */
export function timelineView(
  quote: { startDate: IsoDate; endDate: IsoDate },
  spans: readonly { startDate: IsoDate; endDate: IsoDate }[],
  dates: readonly IsoDate[]
): TimelineView {
  const { start, days } = timelineRange(quote, spans, dates)
  // ReUI's scale is the period in view: "year" shows months, "quarter"
  // weeks, "month" days.
  const scale = days > 100 ? "year" : days > 28 ? "quarter" : "month"
  return { centre: addDays(start, Math.floor(days / 2)), scale, days }
}

export interface TimelineView {
  centre: IsoDate
  scale: "month" | "quarter" | "year"
  /** Days in the span the view opens on. */
  days: number
}

/** ReUI's unit width (rem at zoom 1) per scale: a day, a week, a month. */
const UNIT_REM = { month: 4, quarter: 8, year: 10 } as const
const UNIT_DAYS = { month: 1, quarter: 7, year: 365.25 / 12 } as const
/** ReUI's lowest zoom. */
const MIN_ZOOM = 0.5

/**
 * The opening zoom that fits the view's span into a timeline pane
 * `widthPx` wide (with a little room either side): never above 1, never
 * below ReUI's minimum.
 */
export function fitZoom(view: TimelineView, widthPx: number, remPx = 16) {
  const spanPx =
    (view.days / UNIT_DAYS[view.scale]) * UNIT_REM[view.scale] * remPx
  const room = widthPx * 0.92
  return Math.min(1, Math.max(MIN_ZOOM, room / spanPx))
}

/** One period's slice of a Line Item's bar, shaded by its hours. */
export interface HeatSegment {
  /** Where the period starts and ends along the bar, 0 … 1. */
  from: number
  to: number
  /** `heatLevel` of its hours against the period's capacity (1 … 5). */
  level: number
  periodStart: IsoDate
  hours: string
}

/**
 * A Resource Role line's Allocations as segments of its bar: each period
 * (clipped to the line's dates) at its share of the bar, shaded by its
 * hours against the capacity of those days (working days × Hours Per Day),
 * the Resource Planner's heat. The Allocations are the ones the Planner
 * shows (the default layout until it is first edited); empty periods are
 * left out, so gaps show as the bare bar. Other lines have none.
 */
export function allocationHeat(
  line: PlannerLine,
  { timePeriod, hoursPerDay }: { timePeriod: TimePeriod; hoursPerDay: string }
): HeatSegment[] {
  if (!isPlannerLine(line)) return []
  const type = periodTypeForTimePeriod(timePeriod)
  const spanDays = daysBetween(line.startDate, line.endDate) + 1
  if (spanDays <= 0) return []
  const segments: HeatSegment[] = []
  for (const { periodStart, amount } of shownAllocations(line, timePeriod)) {
    const periodEnd = endOfPeriod(type, periodStart)
    const start =
      compareDates(periodStart, line.startDate) < 0
        ? line.startDate
        : periodStart
    const end =
      compareDates(periodEnd, line.endDate) > 0 ? line.endDate : periodEnd
    if (compareDates(end, start) < 0) continue
    const level = heatLevel(
      amount,
      countWorkingDays(start, end) * Number(hoursPerDay)
    )
    if (level === 0) continue
    segments.push({
      from: daysBetween(line.startDate, start) / spanDays,
      to: (daysBetween(line.startDate, end) + 1) / spanDays,
      level,
      periodStart,
      hours: amount,
    })
  }
  return segments.sort((a, b) => a.from - b.from)
}
