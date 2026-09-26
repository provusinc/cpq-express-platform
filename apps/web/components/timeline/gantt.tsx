"use client"

import { periodTypeForTimePeriod } from "@workspace/domain/dates"
import type { TimePeriod } from "@workspace/domain/enums"
import { PlusIcon } from "lucide-react"
import { useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"

import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Gantt,
  useGanttSelector,
} from "@workspace/ui/components/reui/gantt/gantt"
import type {
  GanttColumn,
  GanttRenderEventProps,
} from "@workspace/ui/components/reui/gantt/gantt"
import {
  GanttNav,
  GanttNavNext,
  GanttNavPrev,
  GanttNavToday,
  GanttScaleSwitcher,
  GanttTitle,
} from "@workspace/ui/components/reui/gantt/gantt-nav"
import type {
  GanttEvent,
  GanttResource,
} from "@workspace/ui/components/reui/gantt/gantt-types"
import { GanttView } from "@workspace/ui/components/reui/gantt/gantt-view"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import type {
  EditorLine,
  EditorMilestone,
  EditorPhase,
} from "@/components/quotes/autosave"
import { PHASE_TINT_CLASSES, SOURCE_KIND_TONES } from "@/components/shell/tints"
import { useHydrated } from "@/components/shell/use-hydrated"
import { formatDate, formatDateRange, formatMonthDay } from "@/lib/format"
import { phaseTints } from "@/lib/phase-tints"
import {
  allocationHeat,
  daySpan,
  dayStart,
  fitZoom,
  milestoneMarks,
  timelineTree,
  timelineView,
} from "@/lib/timeline-gantt"
import type { HeatSegment } from "@/lib/timeline-gantt"

import { LineDetails, MilestoneDetails } from "./timeline-details"
import type { MilestoneActions } from "./timeline-details"

interface TimelineEventData {
  lineId: string
  heat: HeatSegment[]
}

/** What the popup shows, and the box (in the chart) it is anchored to. */
type Detail = (
  | { kind: "line"; lineId: string; heat: HeatSegment[] }
  | { kind: "milestone"; milestoneId: string }
) & { box: { top: number; left: number; width: number; height: number } }

/** An element's box relative to the chart frame. */
function boxIn(frame: HTMLElement, el: Element): Detail["box"] {
  const outer = frame.getBoundingClientRect()
  const inner = el.getBoundingClientRect()
  return {
    top: inner.top - outer.top,
    left: inner.left - outer.left,
    width: inner.width,
    height: inner.height,
  }
}

/** The tree panel's header names the rows, which are not "Resources". */
const I18N = { labels: { resources: "Name" } }

/** Row height in rem (ReUI's minimum row height), for sizing the chart. */
const ROW_REM = 2.5

/** Tree panel: the name column, then the Dates. */
const NAME_WIDTH = 232
const DATES_WIDTH = 124
const TREE_WIDTH = NAME_WIDTH + DATES_WIDTH

/**
 * A period's shade by `heatLevel`, over the bar's own light fill: the bar
 * colour in steps up to a full period, warning above its capacity (the
 * Resource Planner's scale).
 */
export const HEAT_CLASSES: Record<number, string> = {
  1: "bg-(--gantt-event-color)/15",
  2: "bg-(--gantt-event-color)/30",
  3: "bg-(--gantt-event-color)/45",
  4: "bg-(--gantt-event-color)/60",
  5: "bg-warning/70",
}

/**
 * One of ReUI's layers inside `chart`, found by its `data-slot` (and found
 * again if ReUI re-renders it): the timeline body's backdrop or its header.
 */
function useGanttSlot(chart: HTMLElement | null, slot: string) {
  return useSyncExternalStore(
    (notify) => {
      if (!chart) return () => {}
      const observer = new MutationObserver(notify)
      observer.observe(chart, { childList: true, subtree: true })
      return () => observer.disconnect()
    },
    () => chart?.querySelector<HTMLElement>(`[data-slot="${slot}"]`) ?? null,
    () => null
  )
}

/**
 * The Milestones on the chart, which has no rows for them: a line down the
 * body in each one's colour (like ReUI's Today line), and a diamond on it
 * at the foot of the header that opens its popup. ReUI has no marker API,
 * so both are portalled into its layers, placed from the visible range —
 * the same fractions ReUI places its own lines with, so they stay on their
 * day through scrolling, zoom and range growth.
 */
function MilestoneLines({
  chart,
  milestones,
  openId,
  onOpen,
}: {
  chart: HTMLElement | null
  milestones: readonly EditorMilestone[]
  openId: string | null
  onOpen: (milestone: EditorMilestone, diamond: HTMLElement) => void
}) {
  const range = useGanttSelector<unknown, { start: Date; end: Date }>(
    (state) => state.visibleRange,
    {
      isEqual: (a, b) =>
        a.start.getTime() === b.start.getTime() &&
        a.end.getTime() === b.end.getTime(),
    }
  )
  const backdrop = useGanttSlot(chart, "gantt-timeline-backdrop")
  const header = useGanttSlot(chart, "gantt-timeline-header")
  const marks = milestoneMarks(milestones, range)
  const tint = (m: EditorMilestone, strength: number) =>
    `color-mix(in oklab, ${m.colour} ${m.completed ? strength * 0.4 : strength}%, transparent)`

  return (
    <>
      {backdrop &&
        createPortal(
          marks.map(({ milestone: m, at }) => (
            <span
              key={m.id}
              data-slot="timeline-milestone-line"
              className="absolute inset-y-0 w-px"
              style={{
                insetInlineStart: `${at * 100}%`,
                background: `linear-gradient(to bottom, ${tint(m, 100)}, ${tint(m, 30)})`,
              }}
            />
          )),
          backdrop
        )}
      {header &&
        createPortal(
          <TooltipProvider delay={200} closeDelay={0}>
            {marks.map(({ milestone: m, at }) => (
              <Tooltip key={m.id}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-slot="timeline-milestone-mark"
                      aria-label={`${m.name}, ${formatDate(m.date)}`}
                      className={cn(
                        "absolute bottom-0 z-10 size-2.5 -translate-x-1/2 translate-y-1/2 rotate-45 rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        openId === m.id && "ring-2 ring-ring/60"
                      )}
                      style={{
                        insetInlineStart: `${at * 100}%`,
                        backgroundColor: tint(m, 100),
                      }}
                      // the header is ReUI's drag-to-pan surface
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => onOpen(m, e.currentTarget)}
                    />
                  }
                />
                <TooltipContent>
                  {m.name} · {formatDate(m.date)}
                </TooltipContent>
              </Tooltip>
            ))}
          </TooltipProvider>,
          header
        )}
    </>
  )
}

/**
 * A bar's body. Resource Role lines are shaded period by period with their
 * Allocations' hours; the title sits on top and moves outside the bar when
 * it is too narrow (ReUI's "auto" label, the same 7rem).
 */
function TimelineBar({ occurrence }: GanttRenderEventProps<TimelineEventData>) {
  const { event } = occurrence
  const heat = event.data?.heat ?? []
  return (
    <>
      {heat.length > 0 && (
        <span aria-hidden className="pointer-events-none absolute inset-0">
          {heat.map((segment) => (
            <span
              key={segment.periodStart}
              className={cn("absolute inset-y-0", HEAT_CLASSES[segment.level])}
              style={{
                left: `${segment.from * 100}%`,
                width: `${(segment.to - segment.from) * 100}%`,
              }}
            />
          ))}
        </span>
      )}
      <span className="relative hidden truncate font-medium @[7rem]:block">
        {event.title}
      </span>
    </>
  )
}

/**
 * A Phase's rollup: ReUI's envelope (a thin track with end caps) in the
 * Phase's tint, without a percentage since Line Items carry no progress.
 */
function PhaseSummary({ tint }: { tint?: number }) {
  const colour = tint ? PHASE_TINT_CLASSES[tint]!.dot : "bg-muted-foreground"
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "absolute start-0 top-1/2 h-3 w-0.5 -translate-y-1/2 opacity-70",
          colour
        )}
      />
      <span
        aria-hidden
        className={cn(
          "absolute end-0 top-1/2 h-3 w-0.5 -translate-y-1/2 opacity-70",
          colour
        )}
      />
      <div className={cn("h-1.5 opacity-35", colour)} />
    </>
  )
}

/**
 * The Timeline tab's Gantt (ReUI's): the Phase tree, Phases as collapsible
 * groups with a rollup strip, Line Items as bars coloured by source kind (a
 * Resource Role's shaded by its hours per period), and each Milestone as a
 * line down the chart in its colour (`MilestoneLines`). Day to quarter
 * scales, zoom and a Today button come with it; it opens on the Quote's
 * span. Line Items are read-only here (their dates are edited on Line Items
 * and the Planner). Clicking a bar or a Milestone's diamond opens a popup
 * with its details (a Milestone's also has done / edit / delete with
 * `milestoneActions`); `onAddMilestone` puts an Add Milestone button in the
 * toolbar.
 */
export function TimelineGantt({
  quote,
  hoursPerDay,
  currency,
  phases,
  lines,
  milestones,
  milestoneActions,
  onAddMilestone,
}: {
  quote: {
    id: string
    startDate: string
    endDate: string
    timePeriod: TimePeriod
  }
  currency: string
  milestoneActions?: MilestoneActions
  /** The Organization's Hours Per Day, for the Allocation shading. */
  hoursPerDay: string
  phases: readonly EditorPhase[]
  lines: readonly EditorLine[]
  milestones: readonly EditorMilestone[]
  onAddMilestone?: () => void
}) {
  // Client only: the Today line is placed from the clock, which differs
  // between the server render and hydration.
  const hydrated = useHydrated()
  // The open popup: what was clicked and where its bar sits in the chart.
  const [detail, setDetail] = useState<Detail | null>(null)
  // The chart frame: anchors the popup, and holds ReUI's layers the
  // Milestone lines are portalled into.
  const [chart, setChart] = useState<HTMLDivElement | null>(null)
  const resources: GanttResource[] = timelineTree(phases, lines)
  const lineById = new Map(lines.map((l) => [l.id, l]))
  const tints = phaseTints(phases)

  const events: GanttEvent<TimelineEventData>[] = [
    ...lines.map(
      (line): GanttEvent<TimelineEventData> => ({
        id: line.id,
        title: line.name,
        ...daySpan(line.startDate, line.endDate),
        allDay: true,
        color: SOURCE_KIND_TONES[line.sourceKind].colour,
        resourceId: line.id,
        readOnly: true,
        data: {
          lineId: line.id,
          heat: allocationHeat(line, {
            timePeriod: quote.timePeriod,
            hoursPerDay,
          }),
        },
      })
    ),
  ]

  const columns: GanttColumn[] = [
    {
      id: "dates",
      title: "Dates",
      width: DATES_WIDTH,
      className: "text-muted-foreground tabular-nums",
      render: ({ resource }) => {
        const line = lineById.get(resource.id)
        if (!line) return null
        return (
          <span
            className="truncate"
            title={formatDateRange(line.startDate, line.endDate)}
          >
            {line.startDate === line.endDate
              ? formatMonthDay(line.startDate)
              : `${formatMonthDay(line.startDate)} – ${formatMonthDay(line.endDate)}`}
          </span>
        )
      },
    },
  ]

  const view = timelineView(
    quote,
    lines,
    milestones.map((m) => m.date)
  )
  const rowCount = countRows(resources)

  const phaseName = new Map(phases.map((p) => [p.id, p.name]))
  const detailContent = () => {
    if (!detail) return null
    const data = detail
    if (data.kind === "milestone") {
      const milestone = milestones.find((m) => m.id === data.milestoneId)
      return (
        milestone && (
          <MilestoneDetails
            milestone={milestone}
            actions={
              milestoneActions && {
                ...milestoneActions,
                onEdit: (m) => {
                  setDetail(null)
                  milestoneActions.onEdit(m)
                },
                onDelete: (m) => {
                  setDetail(null)
                  milestoneActions.onDelete(m)
                },
              }
            }
          />
        )
      )
    }
    const line = lineById.get(data.lineId)
    return (
      line && (
        <LineDetails
          quoteId={quote.id}
          line={line}
          phaseName={
            line.phaseId ? (phaseName.get(line.phaseId) ?? null) : null
          }
          currency={currency}
          heat={data.heat}
          periodWord={periodTypeForTimePeriod(quote.timePeriod)}
        />
      )
    )
  }

  // The opening zoom fits the span into the timeline pane, so the width is
  // measured before the chart mounts (ReUI reads `defaultZoom` once).
  const [width, setWidth] = useState<number | null>(null)
  const measure = (el: HTMLDivElement | null) => {
    if (el && width === null) setWidth(el.clientWidth)
  }

  const height = `min(44rem, max(20rem, ${rowCount * ROW_REM + 6.5}rem))`
  if (!hydrated || width === null) {
    return (
      <Skeleton
        ref={measure}
        className="w-full rounded-lg"
        style={{ height }}
      />
    )
  }

  return (
    <div
      ref={setChart}
      // isolate: ReUI's sticky header and now-line (z-10/z-30) stack
      // inside the chart, never over the sticky shell header and tab bar
      className="relative isolate overflow-hidden rounded-lg border"
      // The chart scrolls inside itself: tall enough for every row, capped.
      style={{ height }}
      // a popup is anchored where its bar was: scrolling the chart closes it
      onScrollCapture={() => detail && setDetail(null)}
      onWheelCapture={() => detail && setDetail(null)}
    >
      <Gantt<TimelineEventData>
        defaultZoom={fitZoom(view, width - TREE_WIDTH)}
        events={events}
        resources={resources}
        timeZone="UTC"
        i18n={I18N}
        weekStartsOn={1}
        defaultScale={view.scale}
        defaultDate={dayStart(view.centre)}
        initialCenter="anchor"
        interactions={{ drag: false, resize: false, selectSlot: false }}
        onEventClick={(occurrence, e) => {
          const data = occurrence.event.data
          if (!data || !chart) return
          setDetail({
            kind: "line",
            ...data,
            box: boxIn(chart, e.currentTarget as Element),
          })
        }}
        scheduleMode="single"
        rowCheckboxes={false}
        barLabel="auto"
        treePanel={{
          width: TREE_WIDTH,
          nameColumnWidth: NAME_WIDTH,
        }}
        columns={columns}
        renderSummary={({ resource }) => (
          <PhaseSummary tint={tints.get(resource.id)} />
        )}
        renderEvent={TimelineBar}
        renderResourceLabel={({ resource, isGroup }) => {
          if (!isGroup)
            return <span className="truncate">{resource.title}</span>
          const tint = tints.get(resource.id)
          return (
            <span className="flex min-w-0 items-center gap-2">
              {tint && (
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    PHASE_TINT_CLASSES[tint]!.dot
                  )}
                />
              )}
              <span className="truncate font-medium">{resource.title}</span>
            </span>
          )
        }}
        renderNoResources={() => (
          <div className="flex h-16 items-center px-3 text-sm text-muted-foreground">
            No Line Items yet.
          </div>
        )}
        className="size-full text-sm"
      >
        <GanttNav>
          {/* ReUI's default nav, plus the page's primary action at the right */}
          <TooltipProvider delay={600} closeDelay={0} timeout={300}>
            <GanttNavToday />
            <GanttScaleSwitcher />
            <div className="flex items-center">
              <GanttNavPrev />
              <GanttNavNext />
            </div>
            <GanttTitle />
            <div className="grow" />
            {onAddMilestone && (
              <Button variant="outline" size="sm" onClick={onAddMilestone}>
                <PlusIcon data-icon="inline-start" />
                Add Milestone
              </Button>
            )}
          </TooltipProvider>
        </GanttNav>
        <GanttView />
        <MilestoneLines
          chart={chart}
          milestones={milestones}
          openId={detail?.kind === "milestone" ? detail.milestoneId : null}
          onOpen={(m, diamond) =>
            chart &&
            setDetail({
              kind: "milestone",
              milestoneId: m.id,
              box: boxIn(chart, diamond),
            })
          }
        />
      </Gantt>
      <Popover
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
      >
        {/* An invisible trigger over what was clicked anchors the popup. */}
        <PopoverTrigger
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none absolute opacity-0"
          style={detail?.box ?? { top: 0, left: 0, width: 0, height: 0 }}
        />
        <PopoverContent className="w-80" side="bottom" align="start">
          {detailContent()}
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** Every row of the tree, expanded. */
function countRows(nodes: readonly GanttResource[]): number {
  return nodes.reduce(
    (sum, node) => sum + 1 + countRows(node.children ?? []),
    0
  )
}
