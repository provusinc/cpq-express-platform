"use client"

import { CalendarRangeIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { TIME_PERIOD_LABELS } from "@workspace/domain/enums"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import type {
  EditorLine,
  EditorMilestone,
  EditorPhase,
} from "@/components/quotes/autosave"
import type { Quote } from "@/components/quotes/use-quote"
import { useLabels } from "@/components/shell/labels"
import { formatDate } from "@/lib/format"
import { milestoneLabelRows, phaseTimeline } from "@/lib/phase-timeline"

import { OverviewCard } from "./overview-card"

/** Phase tints by top-level order (tokens in globals.css). */
const TINTS: Record<number, string> = {
  1: "bg-phase-1 text-phase-1-ink",
  2: "bg-phase-2 text-phase-2-ink",
  3: "bg-phase-3 text-phase-3-ink",
  4: "bg-phase-4 text-phase-4-ink",
  5: "bg-phase-5 text-phase-5-ink",
}

const pct = (fraction: number) => `${fraction * 100}%`

/** About one Milestone label's width, for staggering close ones. */
const LABEL_PX = 136

/** The element's width, kept up to date (a guess before it is measured). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(1000)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry!.contentRect.width || 1000)
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/**
 * When: the top-level Phases as one segmented bar over the Quote dates
 * (each labelled with its name and length in weeks; overlapping Phases
 * take another lane), a month axis, and the Milestones as markers with
 * their names beneath. The detail is the Timeline tab.
 */
export function PhaseTimelineCard({
  quoteId,
  quote,
  phases,
  lines,
  milestones,
}: {
  quoteId: string
  quote: Quote
  phases: readonly EditorPhase[]
  lines: readonly EditorLine[]
  milestones: readonly EditorMilestone[]
}) {
  const term = useLabels().phase
  const timeline = phaseTimeline({ quote, phases, lines, milestones })
  const [ref, width] = useWidth<HTMLDivElement>()
  const rows = milestoneLabelRows(timeline.milestones, LABEL_PX / width)
  const twoRows = rows.includes(1)
  const empty = timeline.segments.length === 0 && milestones.length === 0

  return (
    <OverviewCard
      title="Timeline"
      description={`${term.plural} and Milestones across the Quote dates · planned in ${TIME_PERIOD_LABELS[quote.timePeriod].toLowerCase()}`}
      link={{ href: `/quotes/${quoteId}/timeline`, label: "Open Timeline" }}
    >
      {empty ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-muted-foreground">
          <CalendarRangeIcon className="size-5" aria-hidden />
          Group Line Items into {term.plural.toLowerCase()} and add Milestones
          to see the plan here.
        </div>
      ) : (
        <div ref={ref} className="flex flex-col gap-2 pt-1">
          {timeline.segments.length > 0 && (
            <ol
              aria-label={term.plural}
              className="relative"
              style={{ height: `${timeline.lanes * 3.25 - 0.25}rem` }}
            >
              {timeline.segments.map((segment) => (
                <li
                  key={segment.id}
                  className="absolute px-px"
                  style={{
                    left: pct(segment.left),
                    width: pct(segment.width),
                    top: `${segment.lane * 3.25}rem`,
                  }}
                >
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <div
                          tabIndex={0}
                          className={cn(
                            "flex h-12 min-w-0 flex-col justify-center rounded-md px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            TINTS[segment.tint]
                          )}
                        />
                      }
                    >
                      <span className="truncate text-sm leading-tight font-medium">
                        {segment.name}
                      </span>
                      <span className="truncate text-xs leading-tight opacity-75">
                        {segment.weeks} {segment.weeks === 1 ? "wk" : "wks"}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {segment.name}: {formatDate(segment.startDate)} –{" "}
                      {formatDate(segment.endDate)}
                    </TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ol>
          )}
          <div aria-hidden className="relative h-5 border-t">
            {timeline.ticks.map((tick) => (
              <span
                key={tick.date}
                className="absolute top-0 flex h-full items-end border-l pl-1 text-[0.7rem] leading-none text-muted-foreground"
                style={{ left: pct(tick.offset) }}
              >
                {tick.label}
              </span>
            ))}
          </div>
          {timeline.milestones.length > 0 && (
            <ol
              aria-label="Milestones"
              className={cn("relative mt-1", twoRows ? "h-21" : "h-12")}
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-1.5 border-t border-dashed"
              />
              {timeline.milestones.map((m, i) => (
                <li
                  key={m.id}
                  className={cn(
                    "absolute top-0 flex max-w-40 flex-col gap-1",
                    m.align === "start" && "items-start",
                    m.align === "center" && "-translate-x-1/2 items-center",
                    m.align === "end" && "-translate-x-full items-end"
                  )}
                  style={{ left: pct(m.offset) }}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-3 rounded-full border-2 ring-2 ring-card",
                      m.align === "start" && "-ml-1.5",
                      m.align === "end" && "-mr-1.5"
                    )}
                    style={{
                      borderColor: m.colour,
                      backgroundColor: m.completed ? "transparent" : m.colour,
                    }}
                  />
                  <span
                    className={cn(
                      "max-w-full truncate text-xs leading-tight font-medium",
                      rows[i] === 1 && "mt-8",
                      m.completed && "text-muted-foreground line-through"
                    )}
                  >
                    {m.name}
                  </span>
                  <span className="text-[0.7rem] leading-none text-muted-foreground">
                    {formatDate(m.date)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {timeline.undated.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Not shown (no Line Items yet):{" "}
              {timeline.undated.map((p) => p.name).join(", ")}
            </p>
          )}
        </div>
      )}
    </OverviewCard>
  )
}
