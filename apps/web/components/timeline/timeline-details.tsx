"use client"

import { ArrowRightIcon, PencilIcon, Trash2Icon } from "lucide-react"
import Link from "next/link"

import { daysBetween } from "@workspace/domain/dates"
import { MILESTONE_TYPE_LABELS } from "@workspace/domain/enums"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Label } from "@workspace/ui/components/label"
import {
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@workspace/ui/components/popover"
import { Separator } from "@workspace/ui/components/separator"

import type { EditorLine, EditorMilestone } from "@/components/quotes/autosave"
import { ItemTypeTag } from "@/components/shell/tints"
import { formatDate, formatDateRange } from "@/lib/format"
import { formatMoney } from "@/lib/money"
import type { HeatSegment } from "@/lib/timeline-gantt"

/** What a Milestone's popup can do; absent when the viewer can't edit. */
export interface MilestoneActions {
  onToggle: (milestone: EditorMilestone, completed: boolean) => void
  onEdit: (milestone: EditorMilestone) => void
  onDelete: (milestone: EditorMilestone) => void
}

/** "3 wks" / "5 days" for an inclusive span. */
function spanLabel(start: string, end: string) {
  const days = daysBetween(start, end) + 1
  if (days >= 14) return `${Math.round(days / 7)} wks`
  return days === 1 ? "1 day" : `${days} days`
}

/** A trimmed quantity: "320.000" → "320", "2.500" → "2.5". */
const trimQuantity = (quantity: string) =>
  quantity.includes(".") ? quantity.replace(/\.?0+$/, "") : quantity

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="text-end">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * A Line Item's popup on the Timeline: its kind and Phase, dates, quantity,
 * rate, total and margin, and for a Resource Role its busiest period; links
 * to the tab where it is edited.
 */
export function LineDetails({
  quoteId,
  line,
  phaseName,
  currency,
  heat,
  periodWord,
}: {
  quoteId: string
  line: EditorLine
  phaseName: string | null
  currency: string
  heat: readonly HeatSegment[]
  /** "week" / "month" / "quarter": the Quote's planning bucket. */
  periodWord: string
}) {
  const hourly = line.billingUnit === "hour"
  const peak = heat.reduce<HeatSegment | null>(
    (best, s) => (!best || Number(s.hours) > Number(best.hours) ? s : best),
    null
  )
  const rows: [string, React.ReactNode][] = [
    [
      "Dates",
      <>
        {formatDateRange(line.startDate, line.endDate)}
        <span className="text-muted-foreground">
          {" "}
          · {spanLabel(line.startDate, line.endDate)}
        </span>
      </>,
    ],
    [
      hourly ? "Effort" : "Quantity",
      hourly ? `${trimQuantity(line.quantity)} h` : trimQuantity(line.quantity),
    ],
    ["Rate", `${formatMoney(line.unitPrice, currency)}${hourly ? " / h" : ""}`],
    ["Total", formatMoney(line.lineTotal, currency)],
    ["Margin", `${Number(line.lineMarginPct).toFixed(1)}%`],
  ]
  if (peak)
    rows.push([
      "Busiest",
      <>
        {trimQuantity(peak.hours)} h
        <span className="text-muted-foreground">
          {" "}
          · {periodWord} of {formatDate(peak.periodStart)}
        </span>
      </>,
    ])

  const planner = line.sourceKind === "resource_role" && hourly
  return (
    <>
      <PopoverHeader>
        <PopoverTitle className="truncate">{line.name}</PopoverTitle>
        <PopoverDescription>
          <ItemTypeTag line={line} />
          {phaseName && ` · ${phaseName}`}
        </PopoverDescription>
      </PopoverHeader>
      <Separator />
      <Facts rows={rows} />
      <Separator />
      <Button
        variant="ghost"
        size="sm"
        className="justify-between"
        render={
          <Link
            href={`/quotes/${quoteId}${planner ? "/planner" : "/line-items"}`}
          />
        }
        nativeButton={false}
      >
        {planner ? "Open in Resource Planner" : "Open in Line Items"}
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    </>
  )
}

/**
 * A Milestone's popup: type, date and description; an editor also marks it
 * done, edits it (the Milestone dialog) or deletes it (Undo in the toast).
 */
export function MilestoneDetails({
  milestone,
  actions,
}: {
  milestone: EditorMilestone
  actions?: MilestoneActions
}) {
  const doneId = `milestone-done-${milestone.id}`
  return (
    <>
      <PopoverHeader>
        <PopoverTitle className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rotate-45 rounded-[2px]"
            style={{ backgroundColor: milestone.colour }}
          />
          <span
            className={
              milestone.completed
                ? "truncate text-muted-foreground line-through"
                : "truncate"
            }
          >
            {milestone.name}
          </span>
        </PopoverTitle>
        <PopoverDescription>
          {MILESTONE_TYPE_LABELS[milestone.type]} · {formatDate(milestone.date)}
        </PopoverDescription>
      </PopoverHeader>
      {milestone.description && (
        <p className="text-sm whitespace-pre-line text-muted-foreground">
          {milestone.description}
        </p>
      )}
      <Separator />
      <div className="flex items-center gap-2">
        <Checkbox
          id={doneId}
          checked={milestone.completed}
          disabled={!actions}
          onCheckedChange={(checked) =>
            actions?.onToggle(milestone, checked === true)
          }
        />
        <Label htmlFor={doneId} className="font-normal">
          Completed
        </Label>
        {actions && (
          <div className="ml-auto flex">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${milestone.name}`}
              onClick={() => actions.onEdit(milestone)}
            >
              <PencilIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${milestone.name}`}
              onClick={() => actions.onDelete(milestone)}
            >
              <Trash2Icon />
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
