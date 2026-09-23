"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import {
  CalendarClockIcon,
  CalendarPlusIcon,
  ClockIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  XCircleIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import Link from "next/link"

import { EXPIRING_SOON_DAYS, INSIGHT_LABELS } from "@workspace/domain/insights"
import type { InsightKey, InsightSeverity } from "@workspace/domain/insights"
import { cn } from "@workspace/ui/lib/utils"

import { insightFocusQuery } from "@/lib/key-insights"
import { wholeMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

const ICONS: Record<InsightKey, LucideIcon> = {
  pending_approval: ClockIcon,
  high_value_pipeline: TrendingUpIcon,
  low_margin: TrendingDownIcon,
  expiring_soon: CalendarClockIcon,
  this_month: CalendarPlusIcon,
  rejected: XCircleIcon,
}

/** What each card counts, under its figure. */
const DESCRIPTIONS: Record<InsightKey, string> = {
  pending_approval: "Waiting for an Approver",
  high_value_pipeline: "Draft and Pending Approval",
  low_margin: "Under 15 % margin, undecided",
  expiring_soon: `Valid Until within ${EXPIRING_SOON_DAYS} days`,
  this_month: "Quotes created this month",
  rejected: "Rejected and Customer Rejected",
}

/** The severity rule along a card's top edge, and its faint wash. */
const SEVERITY_CELL: Record<InsightSeverity, string> = {
  info: "before:bg-transparent",
  warning: "bg-warning-soft/60 before:bg-warning",
  critical: "bg-danger-soft/70 before:bg-danger",
}

const SEVERITY_TAG: Record<Exclude<InsightSeverity, "info">, string> = {
  warning: "bg-warning-soft text-warning-ink ring-warning/40",
  critical: "bg-danger-soft text-danger-ink ring-danger/40",
}

const SEVERITY_LABELS: Record<InsightSeverity, string> = {
  info: "Info",
  warning: "Needs attention",
  critical: "Critical",
}

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`)

/**
 * The Key Insights strip at the top of the Dashboard: one metric cell per
 * insight (big count, its value, a severity rule and tag when it needs
 * attention). Each links to the Quote list filtered to its Quotes
 * (`/quotes?insight=…`, shareable).
 */
export function KeyInsights() {
  const trpc = useTRPC()
  const { data } = useSuspenseQuery(trpc.quote.insights.queryOptions())

  return (
    <section
      aria-label="Key Insights"
      className="grid gap-px overflow-hidden rounded-xl bg-border ring-1 ring-border sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
    >
      {data.cards.map((card) => {
        const Icon = ICONS[card.key]
        return (
          <Link
            key={card.key}
            href={`/quotes${insightFocusQuery({ kind: "insight", key: card.key })}`}
            className={cn(
              "group relative flex min-w-0 flex-col gap-2 bg-card px-4 pt-4 pb-3.5 transition-colors outline-none",
              "before:absolute before:inset-x-0 before:top-0 before:h-[3px]",
              "hover:bg-muted/60 focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
              SEVERITY_CELL[card.severity]
            )}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <Icon
                className={cn(
                  "size-4 text-muted-foreground",
                  card.severity === "warning" && "text-warning-ink",
                  card.severity === "critical" && "text-danger-ink"
                )}
                aria-hidden
              />
              <span className="truncate">{INSIGHT_LABELS[card.key]}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="figure text-[2.5rem] leading-none font-semibold">
                {card.count}
              </span>
              <span className="figure truncate text-base font-medium text-muted-foreground">
                {wholeMoney(card.value, data.currencyCode)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {card.severity === "info" ? (
                <span className="sr-only">{SEVERITY_LABELS.info}</span>
              ) : (
                <span
                  className={cn(
                    "mr-1.5 inline-block rounded-sm px-1.5 py-px text-[0.7rem] font-medium whitespace-nowrap ring-1 ring-inset",
                    SEVERITY_TAG[card.severity]
                  )}
                >
                  {SEVERITY_LABELS[card.severity]}
                </span>
              )}
              {DESCRIPTIONS[card.key]}
              {card.key === "pending_approval" &&
                card.oldestAgeDays !== null &&
                `, oldest ${days(card.oldestAgeDays)}`}
            </p>
          </Link>
        )
      })}
    </section>
  )
}
