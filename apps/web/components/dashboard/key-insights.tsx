"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import {
  CalendarClockIcon,
  ClockIcon,
  TrendingDownIcon,
  XCircleIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import Link from "next/link"

import {
  VALID_UNTIL_SOON_DAYS,
  INSIGHT_LABELS,
} from "@workspace/domain/insights"
import type { InsightKey, InsightSeverity } from "@workspace/domain/insights"
import { cn } from "@workspace/ui/lib/utils"

import { insightFocusQuery } from "@/lib/key-insights"
import { wholeMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

/**
 * The insights that ask for action, in strip order. High-value pipeline
 * and This month stay list filters, but the Dashboard header's open value
 * and the chart already say them.
 */
const STRIP = [
  "pending_approval",
  "low_margin",
  "valid_until_soon",
  "rejected",
] as const satisfies readonly InsightKey[]
type StripKey = (typeof STRIP)[number]

const ICONS: Record<StripKey, LucideIcon> = {
  pending_approval: ClockIcon,
  low_margin: TrendingDownIcon,
  valid_until_soon: CalendarClockIcon,
  rejected: XCircleIcon,
}

/** What each cell counts, under its figure. */
const DESCRIPTIONS: Record<StripKey, string> = {
  pending_approval: "Waiting for an Approver",
  low_margin: "Under 15 % margin, undecided",
  valid_until_soon: `Valid Until within ${VALID_UNTIL_SOON_DAYS} days`,
  rejected: "Rejected and Customer Rejected",
}

/**
 * Only a cell that needs attention takes a colour: a warning inks its
 * icon, a critical one its icon and count.
 */
const ICON_INK: Record<InsightSeverity, string> = {
  info: "text-muted-foreground",
  warning: "text-warning-ink",
  critical: "text-danger-ink",
}
const COUNT_INK: Record<InsightSeverity, string> = {
  info: "",
  warning: "",
  critical: "text-danger-ink",
}

const SEVERITY_LABELS: Record<InsightSeverity, string | null> = {
  info: null,
  warning: "Needs attention",
  critical: "Critical",
}

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`)

/**
 * The Key Insights strip at the top of the Dashboard: the four insights
 * that ask for action, each a cell with its count and value that links to
 * the Quote list filtered to its Quotes (`/quotes?insight=…`, shareable).
 * Severity is quiet: a cell that needs attention inks its icon (and a
 * critical one its count), the rest stay neutral; a zero count is muted.
 */
export function KeyInsights() {
  const trpc = useTRPC()
  const { data } = useSuspenseQuery(trpc.quote.insights.queryOptions())
  const cards = STRIP.map((key) => data.cards.find((c) => c.key === key)!)

  return (
    <section
      aria-label="Key Insights"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-border lg:grid-cols-4"
    >
      {cards.map((card) => {
        const key = card.key as StripKey
        const Icon = ICONS[key]
        const severity = SEVERITY_LABELS[card.severity]
        return (
          <Link
            key={key}
            href={`/quotes${insightFocusQuery({ kind: "insight", key })}`}
            className="group flex min-w-0 flex-col gap-1.5 bg-card px-4 py-3 transition-colors outline-none hover:bg-muted/60 focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon
                className={cn("size-4", ICON_INK[card.severity])}
                aria-hidden
              />
              <span className="truncate font-medium text-foreground">
                {INSIGHT_LABELS[key]}
              </span>
              {severity && <span className="sr-only">, {severity}</span>}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "figure text-3xl leading-none font-semibold",
                  card.count === 0
                    ? "text-muted-foreground"
                    : COUNT_INK[card.severity]
                )}
              >
                {card.count}
              </span>
              {card.count > 0 && (
                <span className="figure truncate text-sm text-muted-foreground">
                  {wholeMoney(card.value, data.currencyCode)}
                </span>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {key === "pending_approval" && card.oldestAgeDays !== null
                ? `Oldest waiting ${days(card.oldestAgeDays)}`
                : DESCRIPTIONS[key]}
            </p>
          </Link>
        )
      })}
    </section>
  )
}
