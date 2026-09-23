/**
 * The Overview's Phase timeline, as pure layout: each top-level Phase as a
 * segment over its date span (its lines', from the domain's
 * `phaseRollups`), packed into as few lanes as don't overlap, the
 * Milestones as markers, and the month ticks — all as fractions of the
 * width over `timelineRange` (the Quote dates widened to cover them).
 */
import { compareDates, daysBetween } from "@workspace/domain/dates"
import type { IsoDate } from "@workspace/domain/dates"
import { phaseRollups } from "@workspace/domain/phases"

import { barSpan, dayCentre, timelineRange, timelineTicks } from "./timeline"
import type { TimelineRange, TimelineTick } from "./timeline"

/** How many Phase tints there are (`bg-phase-1` … `bg-phase-5`). */
export const PHASE_TINTS = 5

export interface PhaseSegment {
  id: string
  name: string
  startDate: IsoDate
  endDate: IsoDate
  left: number
  width: number
  /** Whole weeks, at least 1 (both days inclusive). */
  weeks: number
  lane: number
  /** 1 … PHASE_TINTS, by top-level order. */
  tint: number
}

export interface MilestoneMarker {
  id: string
  name: string
  date: IsoDate
  colour: string
  completed: boolean
  offset: number
  /** Where its label hangs, so labels at the edges stay inside. */
  align: "start" | "center" | "end"
}

export interface PhaseTimeline {
  range: TimelineRange
  segments: PhaseSegment[]
  lanes: number
  milestones: MilestoneMarker[]
  ticks: TimelineTick[]
  /** Top-level Phases without dated lines (not drawn). */
  undated: { id: string; name: string }[]
}

export function phaseTimeline(input: {
  quote: { startDate: IsoDate; endDate: IsoDate }
  phases: readonly {
    id: string
    parentId: string | null
    name: string
    sequence: number
  }[]
  lines: Parameters<typeof phaseRollups>[1]
  milestones: readonly {
    id: string
    name: string
    date: IsoDate
    colour: string
    completed: boolean
  }[]
}): PhaseTimeline {
  const rollups = phaseRollups(input.phases, input.lines)
  const top = input.phases
    .filter((p) => p.parentId === null)
    .sort((a, b) => a.sequence - b.sequence)
  const dated = top.flatMap((phase, index) => {
    const r = rollups[phase.id]
    return r?.startDate && r.endDate
      ? [{ phase, index, startDate: r.startDate, endDate: r.endDate }]
      : []
  })
  const range = timelineRange(
    input.quote,
    dated,
    input.milestones.map((m) => m.date)
  )

  // Greedy lanes in start order: the first lane whose last end is before.
  const laneEnds: IsoDate[] = []
  const segments = [...dated]
    .sort((a, b) => compareDates(a.startDate, b.startDate) || a.index - b.index)
    .map(({ phase, index, startDate, endDate }) => {
      let lane = laneEnds.findIndex((end) => compareDates(end, startDate) < 0)
      if (lane === -1) lane = laneEnds.push(endDate) - 1
      else laneEnds[lane] = endDate
      const { left, width } = barSpan(range, startDate, endDate)
      return {
        id: phase.id,
        name: phase.name,
        startDate,
        endDate,
        left,
        width,
        weeks: Math.max(
          1,
          Math.round((daysBetween(startDate, endDate) + 1) / 7)
        ),
        lane,
        tint: (index % PHASE_TINTS) + 1,
      }
    })

  const milestones = [...input.milestones]
    .sort((a, b) => compareDates(a.date, b.date))
    .map((m) => {
      const offset = dayCentre(range, m.date)
      return {
        id: m.id,
        name: m.name,
        date: m.date,
        colour: m.colour,
        completed: m.completed,
        offset,
        align:
          offset < 0.12
            ? ("start" as const)
            : offset > 0.88
              ? ("end" as const)
              : ("center" as const),
      }
    })

  return {
    range,
    segments,
    lanes: laneEnds.length,
    milestones,
    ticks: timelineTicks(range),
    undated: top
      .filter((p) => !dated.some((d) => d.phase.id === p.id))
      .map((p) => ({ id: p.id, name: p.name })),
  }
}

/**
 * Which label row each Milestone's name takes (0 or 1, in date order) so
 * neighbours closer than `minGap` (a fraction of the width, about one
 * label) don't overprint: the second of two close ones drops a row.
 */
export function milestoneLabelRows(
  markers: readonly { offset: number }[],
  minGap: number
): number[] {
  const last = [-Infinity, -Infinity]
  return markers.map(({ offset }) => {
    const row =
      offset - last[0]! >= minGap ? 0 : offset - last[1]! >= minGap ? 1 : 0
    last[row] = offset
    return row
  })
}
