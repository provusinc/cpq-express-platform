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
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

import { formatMoney } from "@/lib/money"
import { insightFocusQuery } from "@/lib/key-insights"
import type { InsightFocus } from "@/lib/key-insights"
import { useTRPC } from "@/trpc/react"

import { QuoteStatusBadge } from "./quote-status-badge"

const ICONS: Record<InsightKey, LucideIcon> = {
  pending_approval: ClockIcon,
  high_value_pipeline: TrendingUpIcon,
  low_margin: TrendingDownIcon,
  this_month: CalendarPlusIcon,
  rejected: XCircleIcon,
}

/** What each card counts, under its title. */
const DESCRIPTIONS: Record<InsightKey, string> = {
  pending_approval: "Waiting for an Approver",
  high_value_pipeline: "Draft and Pending Approval",
  low_margin: "Margin below 15 %, not yet decided",
  this_month: "Quotes created this month",
  rejected: "Rejected and Customer Rejected",
}

const SEVERITY_CARD: Record<InsightSeverity, string> = {
  info: "",
  warning:
    "bg-amber-50 ring-amber-500/40 dark:bg-amber-500/10 dark:ring-amber-400/40",
  critical: "bg-destructive/5 ring-destructive/40 dark:bg-destructive/10",
}

const SEVERITY_BADGE: Record<Exclude<InsightSeverity, "info">, string> = {
  warning:
    "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
  critical: "bg-destructive/10 text-destructive dark:bg-destructive/20",
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
 * The Key Insight cards above the Quote list, coloured by severity, then
 * the count per status and the caller's recent Quotes. A card or status
 * count links to the list filtered to its Quotes (`?insight=…` /
 * `?status=…`, shareable); the active one links back to the whole list.
 */
export function KeyInsights({ focus }: { focus: InsightFocus | null }) {
  const trpc = useTRPC()
  const { data } = useSuspenseQuery(trpc.quote.insights.queryOptions())
  const hrefFor = (target: InsightFocus) =>
    sameFocus(focus, target) ? "/quotes" : `/quotes${insightFocusQuery(target)}`

  return (
    <section aria-label="Key Insights" className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {data.cards.map((card) => {
          const target: InsightFocus = { kind: "insight", key: card.key }
          const active = sameFocus(focus, target)
          const Icon = ICONS[card.key]
          return (
            <Link
              key={card.key}
              href={hrefFor(target)}
              scroll={false}
              aria-current={active ? "true" : undefined}
              className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Card
                size="sm"
                className={cn(
                  "h-full transition-colors hover:bg-muted/50",
                  SEVERITY_CARD[card.severity],
                  active && "ring-2 ring-primary"
                )}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" />
                    {INSIGHT_LABELS[card.key]}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {DESCRIPTIONS[card.key]}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-2xl font-semibold tabular-nums">
                      {card.count}
                    </span>
                    {card.severity === "info" ? (
                      <span className="sr-only">
                        {SEVERITY_LABELS[card.severity]}
                      </span>
                    ) : (
                      <Badge className={SEVERITY_BADGE[card.severity]}>
                        {SEVERITY_LABELS[card.severity]}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {wholeMoney(card.value, data.currencyCode)}
                    {card.key === "pending_approval" &&
                      card.oldestAgeDays !== null &&
                      ` · oldest ${days(card.oldestAgeDays)}`}
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <div className="grid gap-3 lg:grid-cols-[2fr_3fr]">
        <Card size="sm">
          <CardHeader>
            <CardTitle>By status</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
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
                        "flex items-center gap-1.5 rounded-full border px-1 py-0.5 pr-2 text-xs hover:bg-muted",
                        active && "border-primary ring-1 ring-primary"
                      )}
                    >
                      <QuoteStatusBadge status={status} />
                      <span className="font-medium tabular-nums">
                        {data.statusCounts[status]}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>Your recent Quotes</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Quotes you create or change appear here.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {data.recent.map((quote) => (
                  <li key={quote.id}>
                    <Link
                      href={`/quotes/${quote.id}`}
                      className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted"
                    >
                      <span className="truncate font-medium">{quote.name}</span>
                      <span className="truncate text-muted-foreground">
                        {quote.account.name}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        <span className="text-xs tabular-nums">
                          {formatMoney(quote.total, quote.currencyCode)}
                        </span>
                        <QuoteStatusBadge status={quote.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
