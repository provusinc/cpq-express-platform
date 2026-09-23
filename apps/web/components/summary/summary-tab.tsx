"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { CalendarX2Icon } from "lucide-react"
import Link from "next/link"

import { Decimal } from "@workspace/domain/money"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

import { ApprovalHistory } from "@/components/approval/approval-history"
import { QUOTE_POLL_MS } from "@/components/quotes/autosave"
import { useQuote } from "@/components/quotes/quote-header"
import { formatDate } from "@/lib/format"
import { formatMoney, trimMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

import { CostChangeLog } from "./cost-change-log"
import { ItemTypeBreakdown } from "./item-type-breakdown"

/**
 * The Quote editor's Summary tab: who and when (Account, primary Contact,
 * Owner, Valid Until), the server-computed totals, the item-type
 * breakdown, the approval history and the cost change log. The page
 * prefetches every query it reads.
 */
export function SummaryTab({ quoteId }: { quoteId: string }) {
  const trpc = useTRPC()
  const quote = useQuote(quoteId)
  const summary = useSuspenseQuery({
    ...trpc.quote.summary.queryOptions({ id: quoteId }),
    refetchOnWindowFocus: true,
    refetchInterval: QUOTE_POLL_MS,
  }).data
  const { totals } = summary
  const currency = totals.currencyCode
  const money = (amount: string) => formatMoney(amount, currency)
  const contact = summary.primaryContact

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Account</dt>
            <dd>
              <Link
                href={`/accounts/${summary.account.id}`}
                className="font-medium hover:underline"
              >
                {summary.account.name}
              </Link>
            </dd>
            <dt className="text-muted-foreground">Primary Contact</dt>
            <dd>
              {contact ? (
                <div className="flex flex-col">
                  <span className="font-medium">{contact.name}</span>
                  {contact.title && (
                    <span className="text-muted-foreground">
                      {contact.title}
                    </span>
                  )}
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="text-muted-foreground hover:underline"
                    >
                      {contact.email}
                    </a>
                  )}
                  {contact.phone && (
                    <span className="text-muted-foreground">
                      {contact.phone}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-muted-foreground">None set</span>
              )}
            </dd>
            <dt className="text-muted-foreground">Owner</dt>
            <dd>{summary.owner.name ?? summary.owner.email}</dd>
            <dt className="text-muted-foreground">Dates</dt>
            <dd>
              {formatDate(summary.startDate)} – {formatDate(summary.endDate)}
            </dd>
            <dt className="text-muted-foreground">Valid until</dt>
            <dd>
              {summary.validUntil ? (
                <span
                  className={cn(
                    quote.validUntilPassed &&
                      "inline-flex items-center gap-1 font-medium text-destructive"
                  )}
                >
                  {quote.validUntilPassed && (
                    <CalendarX2Icon className="size-3.5" aria-hidden />
                  )}
                  {formatDate(summary.validUntil)}
                  {quote.validUntilPassed && " (passed)"}
                </span>
              ) : (
                "—"
              )}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Totals</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm tabular-nums">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right">{money(totals.subtotal)}</dd>
            <dt className="text-muted-foreground">
              Quote Discount
              {totals.discountKind === "percent" &&
                totals.discountValue !== null &&
                ` (${trimMoney(totals.discountValue)}%)`}
            </dt>
            <dd className="text-right">
              {new Decimal(totals.discountAmount).isZero()
                ? "—"
                : `−${money(totals.discountAmount)}`}
            </dd>
            <dt className="border-t pt-2 font-medium">Total</dt>
            <dd className="border-t pt-2 text-right text-base font-semibold">
              {money(totals.total)}
            </dd>
            <dt className="text-muted-foreground">Cost</dt>
            <dd className="text-right">{money(totals.cost)}</dd>
            <dt className="text-muted-foreground">Margin</dt>
            <dd
              className={cn(
                "text-right font-medium",
                totals.margin.startsWith("-") && "text-destructive"
              )}
            >
              {money(totals.margin)} ({new Decimal(totals.marginPct).toFixed(1)}
              %)
            </dd>
          </dl>
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <ItemTypeBreakdown breakdown={summary.breakdown} currency={currency} />
      </div>

      <ApprovalHistory quoteId={quoteId} />
      <CostChangeLog quoteId={quoteId} />
    </div>
  )
}
