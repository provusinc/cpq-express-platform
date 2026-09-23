"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import {
  CalendarPlusIcon,
  ClockIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  XCircleIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import Link from "next/link"

import { QUOTE_STATUS_LABELS, QUOTE_STATUSES } from "@workspace/domain/enums"
import { INSIGHT_LABELS } from "@workspace/domain/insights"
import type { InsightKey, InsightSeverity } from "@workspace/domain/insights"
import { Decimal } from "@workspace/domain/money"
import { cn } from "@workspace/ui/lib/utils"

import { formatMoney } from "@/lib/money"
import { insightFocusQuery } from "@/lib/key-insights"
import type { InsightFocus } from "@/lib/key-insights"
import { useTRPC } from "@/trpc/react"

import { QuoteStatusBadge, STATUS_SOLID } from "./quote-status-badge"

const ICONS: Record<InsightKey, LucideIcon> = {
  pending_approval: ClockIcon,
  high_value_pipeline: TrendingUpIcon,
  low_margin: TrendingDownIcon,
  this_month: CalendarPlusIcon,
  rejected: XCircleIcon,
}

/** What each card counts, under its figure. */
const DESCRIPTIONS: Record<InsightKey, string> = {
  pending_approval: "Waiting for an Approver",
  high_value_pipeline: "Draft and Pending Approval",
  low_margin: "Margin below 15 %, not yet decided",
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

/** A whole-unit amount for a card ("$12,346"). */
const wholeMoney = (value: string, currency: string) =>
  formatMoney(new Decimal(value).toFixed(0), currency)

const days = (n: number) => (n === 1 ? "1 day" : `${n} days`)

const sameFocus = (a: InsightFocus | null, b: InsightFocus) =>
  insightFocusQuery(a) === insightFocusQuery(b)

/**
 * The Key Insights above the Quote list: one strip of metric cells (big
 * count, pipeline value, a severity rule and tag when it needs attention),
 * then the status mix as a proportional bar with its legend, and the
 * caller's recent Quotes. A cell or status links to the list filtered to
 * its Quotes (`?insight=…` / `?status=…`, shareable); the active one links
 * back to the whole list.
 */
export function KeyInsights({ focus }: { focus: InsightFocus | null }) {
  const trpc = useTRPC()
  const { data } = useSuspenseQuery(trpc.quote.insights.queryOptions())
  const hrefFor = (target: InsightFocus) =>
    sameFocus(focus, target) ? "/quotes" : `/quotes${insightFocusQuery(target)}`
  const statusTotal = QUOTE_STATUSES.reduce(
    (sum, status) => sum + data.statusCounts[status],
    0
  )

  return (
    <section aria-label="Key Insights" className="flex flex-col gap-3">
      <div className="grid overflow-hidden rounded-xl border bg-card sm:grid-cols-2 lg:grid-cols-5">
        {data.cards.map((card, i) => {
          const target: InsightFocus = { kind: "insight", key: card.key }
          const active = sameFocus(focus, target)
          const Icon = ICONS[card.key]
          return (
            <Link
              key={card.key}
              href={hrefFor(target)}
              scroll={false}
              aria-current={active ? "true" : undefined}
              className={cn(
                "group relative flex flex-col gap-2 border-border px-4 pt-4 pb-3.5 transition-colors outline-none",
                "before:absolute before:inset-x-0 before:top-0 before:h-[3px]",
                "hover:bg-muted/60 focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
                // Rules between cells: rows on small screens, columns on wide.
                i > 0 && "max-sm:border-t",
                i % 2 === 1 && "sm:max-lg:border-l",
                i > 1 && "sm:max-lg:border-t",
                i > 0 && "lg:border-l",
                SEVERITY_CELL[card.severity],
                active &&
                  "bg-accent after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary hover:bg-accent"
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
                  <span className="sr-only">
                    {SEVERITY_LABELS[card.severity]}
                  </span>
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
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">Status mix</h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {statusTotal} {statusTotal === 1 ? "Quote" : "Quotes"}
            </span>
          </div>
          {statusTotal > 0 && (
            <div
              aria-hidden
              className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
            >
              {QUOTE_STATUSES.filter((s) => data.statusCounts[s] > 0).map(
                (status) => (
                  <Link
                    key={status}
                    href={hrefFor({ kind: "status", status })}
                    scroll={false}
                    tabIndex={-1}
                    title={`${QUOTE_STATUS_LABELS[status]}: ${data.statusCounts[status]}`}
                    className={cn(
                      "h-full min-w-1.5 transition-opacity hover:opacity-80",
                      STATUS_SOLID[status]
                    )}
                    style={{ flexGrow: data.statusCounts[status] }}
                  />
                )
              )}
            </div>
          )}
          <ul className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
            {QUOTE_STATUSES.map((status) => {
              const target: InsightFocus = { kind: "status", status }
              const active = sameFocus(focus, target)
              return (
                <li key={status}>
                  <Link
                    href={hrefFor(target)}
                    scroll={false}
                    aria-current={active ? "true" : undefined}
                    aria-label={`${QUOTE_STATUS_LABELS[status]}: ${data.statusCounts[status]}`}
                    className={cn(
                      "-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                      active && "bg-accent font-medium hover:bg-accent"
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        STATUS_SOLID[status]
                      )}
                    />
                    <span className="truncate">
                      {QUOTE_STATUS_LABELS[status]}
                    </span>
                    <span
                      className={cn(
                        "ml-auto font-medium tabular-nums",
                        data.statusCounts[status] === 0 &&
                          "text-muted-foreground"
                      )}
                    >
                      {data.statusCounts[status]}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4">
          <h2 className="text-sm font-medium">Your recent Quotes</h2>
          {data.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Quotes you create or change appear here.
            </p>
          ) : (
            <ul className="-mx-1.5 flex flex-col">
              {data.recent.map((quote) => (
                <li key={quote.id}>
                  <Link
                    href={`/quotes/${quote.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-1.5 py-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)_6.5rem_auto]"
                  >
                    <span className="truncate font-medium">{quote.name}</span>
                    <span className="hidden truncate text-muted-foreground sm:block">
                      {quote.account.name}
                    </span>
                    <span className="hidden text-right tabular-nums sm:block">
                      {formatMoney(quote.total, quote.currencyCode)}
                    </span>
                    <QuoteStatusBadge
                      status={quote.status}
                      className="justify-self-end"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
