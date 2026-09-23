"use client"

import { useQuery } from "@tanstack/react-query"

import { LOW_MARGIN_THRESHOLD } from "@workspace/domain/insights"
import { Decimal } from "@workspace/domain/money"
import { Progress } from "@workspace/ui/components/progress"
import { cn } from "@workspace/ui/lib/utils"

import { useHydrated } from "@/components/shell/use-hydrated"
import { formatMoney, trimMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

import { useQuote } from "./quote-header"

interface LedgerTotals {
  currencyCode: string
  subtotal: string
  discountAmount: string
  discountKind: "percent" | "amount" | null
  total: string
  margin: string
  marginPct: string
}

/** The meter's full scale: margins at or above this fill it. */
const METER_MAX = 50

/**
 * The open Quote's money, always in view beside the tabs: Subtotal,
 * Discount, Total and Margin % with a meter marking the low-margin line.
 * It follows the editor cache once hydrated (edits re-price there first,
 * optimistically), else the Quote itself.
 */
export function QuoteLedger({
  quoteId,
  className,
}: {
  quoteId: string
  className?: string
}) {
  const quote = useQuote(quoteId)
  return useHydrated() ? (
    <EditorLedger quoteId={quoteId} fallback={quote} className={className} />
  ) : (
    <Ledger totals={quote} className={className} />
  )
}

function EditorLedger({
  quoteId,
  fallback,
  className,
}: {
  quoteId: string
  fallback: LedgerTotals
  className?: string
}) {
  const trpc = useTRPC()
  // Only observes the cache: the tab page fetches the editor if it needs it.
  const { data } = useQuery({
    ...trpc.quote.editor.queryOptions({ id: quoteId }),
    enabled: false,
  })
  return <Ledger totals={data?.totals ?? fallback} className={className} />
}

function Ledger({
  totals,
  className,
}: {
  totals: LedgerTotals
  className?: string
}) {
  const money = (amount: string) => formatMoney(amount, totals.currencyCode)
  const pct = new Decimal(totals.marginPct)
  const hasTotal = !new Decimal(totals.total).isZero()
  const tone = !hasTotal
    ? "neutral"
    : pct.isNegative()
      ? "danger"
      : pct.lessThan(LOW_MARGIN_THRESHOLD)
        ? "warning"
        : "success"
  const fill = Math.max(0, Math.min(100, (pct.toNumber() / METER_MAX) * 100))
  const threshold = (Number(LOW_MARGIN_THRESHOLD) / METER_MAX) * 100
  const hasDiscount = !new Decimal(totals.discountAmount).isZero()

  return (
    <dl
      aria-label="Quote totals"
      className={cn(
        "flex items-center gap-x-5 text-sm whitespace-nowrap",
        className
      )}
    >
      <Figure label="Subtotal" className="max-md:hidden">
        {money(totals.subtotal)}
      </Figure>
      <Figure label="Discount" className="max-md:hidden">
        {hasDiscount ? `−${money(totals.discountAmount)}` : "—"}
      </Figure>
      <Figure label="Margin">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              tone === "danger" && "text-danger-ink",
              tone === "warning" && "text-warning-ink"
            )}
          >
            {trimMoney(new Decimal(totals.marginPct).toFixed(1))}%
          </span>
          <div aria-hidden className="relative w-14">
            <Progress
              value={fill}
              className={cn(
                "gap-0 **:data-[slot=progress-indicator]:rounded-full **:data-[slot=progress-track]:h-1.5",
                tone === "success" &&
                  "**:data-[slot=progress-indicator]:bg-success",
                tone === "warning" &&
                  "**:data-[slot=progress-indicator]:bg-warning",
                tone === "danger" &&
                  "**:data-[slot=progress-indicator]:bg-danger",
                tone === "neutral" &&
                  "**:data-[slot=progress-indicator]:bg-neutral"
              )}
            />
            <span
              className="absolute inset-y-0 w-px bg-foreground/40"
              style={{ left: `${threshold}%` }}
            />
          </div>
        </div>
      </Figure>
      <div className="flex flex-col items-end border-l pl-5">
        <dt className="text-[0.7rem] leading-4 text-muted-foreground">Total</dt>
        <dd className="figure text-xl leading-6 font-semibold">
          {money(totals.total)}
        </dd>
      </div>
    </dl>
  )
}

function Figure({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-col items-end", className)}>
      <dt className="text-[0.7rem] leading-4 text-muted-foreground">{label}</dt>
      <dd className="figure text-[0.95rem] leading-6 font-medium">
        {children}
      </dd>
    </div>
  )
}
