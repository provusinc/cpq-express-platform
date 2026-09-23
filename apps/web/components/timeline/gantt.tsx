"use client"

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"

import { MILESTONE_TYPE_LABELS } from "@workspace/domain/enums"
import type { PhaseRollup } from "@workspace/domain/phases"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import type {
  EditorLine,
  EditorMilestone,
  EditorPhase,
} from "@/components/quotes/autosave"
import { useLabels } from "@/components/shell/labels"
import { formatDate } from "@/lib/format"
import { barSpan, dateOffset, dayCentre, timelineTicks } from "@/lib/timeline"
import type { TimelineRange } from "@/lib/timeline"

/** One Timeline row: a Phase (summary bar over its contents) or a Line Item. */
export type TimelineRow =
  | {
      kind: "phase"
      phase: EditorPhase
      depth: number
      rollup: PhaseRollup
    }
  | { kind: "line"; line: EditorLine; depth: number }

/** Bar colours per source kind (the legend shows them with the labels). */
export const SOURCE_BAR_CLASSES = {
  resource_role: "bg-sky-500/85 dark:bg-sky-400/80",
  product: "bg-amber-500/85 dark:bg-amber-400/80",
  add_on: "bg-emerald-500/85 dark:bg-emerald-400/80",
} as const

const pct = (fraction: number) => `${(fraction * 100).toFixed(4)}%`
const ROW = "h-9"

/** The label column's cell for a row. */
function RowLabel({
  row,
  collapsed,
  onToggle,
}: {
  row: TimelineRow
  collapsed: ReadonlySet<string>
  onToggle: (phaseId: string) => void
}) {
  const labels = useLabels()
  const indent = { paddingLeft: `${row.depth * 1}rem` }
  if (row.kind === "phase") {
    const open = !collapsed.has(row.phase.id)
    const Chevron = open ? ChevronDownIcon : ChevronRightIcon
    return (
      <div
        className={cn(ROW, "flex items-center gap-1 border-b bg-muted/40 pr-2")}
        style={{ paddingLeft: `${(row.depth - 1) * 1}rem` }}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${open ? "Collapse" : "Expand"} ${row.phase.name}`}
          aria-expanded={open}
          onClick={() => onToggle(row.phase.id)}
        >
          <Chevron />
        </Button>
        <span className="truncate text-sm font-semibold">{row.phase.name}</span>
      </div>
    )
  }
  return (
    <div
      className={cn(ROW, "flex min-w-0 flex-col justify-center border-b pr-2")}
      style={{ ...indent, paddingLeft: `calc(${indent.paddingLeft} + 0.5rem)` }}
    >
      <span className="truncate text-sm">{row.line.name}</span>
      <span className="truncate text-[11px] leading-tight text-muted-foreground">
        {labels[row.line.sourceKind].singular}
      </span>
    </div>
  )
}

/** The chart cell for a row: its bar. */
function RowBar({ row, range }: { row: TimelineRow; range: TimelineRange }) {
  if (row.kind === "phase") {
    const { startDate, endDate } = row.rollup
    return (
      <div className={cn(ROW, "relative border-b bg-muted/40")}>
        {startDate && endDate && (
          <div
            className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm bg-foreground/70"
            style={{
              left: pct(barSpan(range, startDate, endDate).left),
              width: pct(barSpan(range, startDate, endDate).width),
            }}
            title={`${row.phase.name}: ${formatDate(startDate)} – ${formatDate(endDate)}`}
          />
        )}
      </div>
    )
  }
  const { line } = row
  const span = barSpan(range, line.startDate, line.endDate)
  return (
    <div className={cn(ROW, "relative border-b")}>
      <div
        role="img"
        aria-label={`${line.name}: ${formatDate(line.startDate)} to ${formatDate(line.endDate)}`}
        title={`${line.name}: ${formatDate(line.startDate)} – ${formatDate(line.endDate)}`}
        className={cn(
          "absolute top-1/2 h-5 min-w-1 -translate-y-1/2 rounded",
          SOURCE_BAR_CLASSES[line.sourceKind]
        )}
        style={{ left: pct(span.left), width: pct(span.width) }}
      />
    </div>
  )
}

/** A Milestone's diamond on the marker lane. */
function MilestoneMarker({
  milestone,
  range,
  onSelect,
}: {
  milestone: EditorMilestone
  range: TimelineRange
  onSelect?: (id: string) => void
}) {
  const label = `${milestone.name} · ${formatDate(milestone.date)} · ${
    MILESTONE_TYPE_LABELS[milestone.type]
  }${milestone.completed ? " · Completed" : ""}`
  const diamond = (
    <span
      className={cn(
        "block size-3 rotate-45 rounded-[2px] border-2",
        milestone.completed && "opacity-60"
      )}
      style={{
        borderColor: milestone.colour,
        backgroundColor: milestone.completed ? "transparent" : milestone.colour,
      }}
    />
  )
  const style = { left: pct(dayCentre(range, milestone.date)) }
  return onSelect ? (
    <button
      type="button"
      title={label}
      aria-label={`Edit Milestone ${label}`}
      className="absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded hover:bg-muted"
      style={style}
      onClick={() => onSelect(milestone.id)}
    >
      {diamond}
    </button>
  ) : (
    <span
      role="img"
      title={label}
      aria-label={`Milestone ${label}`}
      className="absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      style={style}
    >
      {diamond}
    </span>
  )
}

/**
 * The Timeline View's Gantt, drawn with CSS: a label column and a chart
 * whose horizontal scale is `range` (every position is a percentage of the
 * width). Line Items are bars from start to end, coloured by source kind;
 * Phase rows show a summary bar over the span of their contents and
 * collapse. Milestones are diamonds on a lane above the rows with a line
 * down through them; today is marked when it falls in the range.
 * `onSelectMilestone` (editable Quotes) makes the diamonds open the editor.
 */
export function Gantt({
  rows,
  milestones,
  range,
  today,
  collapsed,
  onToggle,
  onSelectMilestone,
}: {
  rows: TimelineRow[]
  milestones: readonly EditorMilestone[]
  range: TimelineRange
  today: string
  collapsed: ReadonlySet<string>
  onToggle: (phaseId: string) => void
  onSelectMilestone?: (id: string) => void
}) {
  const ticks = timelineTicks(range)
  // Skip a label that would run into the previous one (the chart is at
  // least 40rem wide; a label character is about 1.1% of that).
  const labelled = new Set<string>()
  let lastEnd = -1
  for (const tick of ticks) {
    if (tick.offset >= lastEnd) {
      labelled.add(tick.date)
      lastEnd = tick.offset + (tick.label.length + 1) * 0.011
    }
  }
  const todayOffset = dateOffset(range, today)
  const showToday = todayOffset >= 0 && todayOffset < 1
  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="grid min-w-[56rem] grid-cols-[16rem_1fr]">
        {/* Header: the scale. */}
        <div className="flex h-8 items-center border-b px-3 text-xs font-medium text-muted-foreground">
          Name
        </div>
        <div className="relative h-8 border-b">
          {ticks
            .filter((tick) => labelled.has(tick.date))
            .map((tick) => (
              <span
                key={tick.date}
                className="absolute top-1/2 -translate-y-1/2 pl-1 text-xs whitespace-nowrap text-muted-foreground"
                style={{ left: pct(tick.offset) }}
              >
                {tick.label}
              </span>
            ))}
        </div>

        {/* Milestone lane. */}
        <div className="flex h-8 items-center border-b px-3 text-xs font-medium text-muted-foreground">
          Milestones
        </div>
        <div className="relative h-8 border-b">
          {milestones.map((milestone) => (
            <MilestoneMarker
              key={milestone.id}
              milestone={milestone}
              range={range}
              onSelect={onSelectMilestone}
            />
          ))}
        </div>

        {/* Rows. */}
        <div className="min-w-0 border-r">
          {rows.map((row) => (
            <RowLabel
              key={row.kind === "phase" ? row.phase.id : row.line.id}
              row={row}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
          {rows.length === 0 && (
            <div className="flex h-16 items-center px-3 text-sm text-muted-foreground">
              No Line Items yet.
            </div>
          )}
        </div>
        <div className="relative">
          {/* Grid lines, Milestone lines and today, behind the bars. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {ticks.map((tick) => (
              <span
                key={tick.date}
                className="absolute inset-y-0 border-l border-border/60"
                style={{ left: pct(tick.offset) }}
              />
            ))}
            {milestones.map((m) => (
              <span
                key={m.id}
                className="absolute inset-y-0 border-l-2 border-dashed opacity-70"
                style={{
                  left: pct(dayCentre(range, m.date)),
                  borderColor: m.colour,
                }}
              />
            ))}
            {showToday && (
              <span
                className="absolute inset-y-0 border-l-2 border-destructive/70"
                style={{ left: pct(todayOffset) }}
              />
            )}
          </div>
          {rows.map((row) => (
            <RowBar
              key={row.kind === "phase" ? row.phase.id : row.line.id}
              row={row}
              range={range}
            />
          ))}
          {rows.length === 0 && <div className="h-16" />}
        </div>
      </div>
    </div>
  )
}
