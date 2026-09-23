import Link from "next/link"

import type { RouterOutputs } from "@workspace/api"
import { Decimal } from "@workspace/domain/money"
import { Progress } from "@workspace/ui/components/progress"
import { cn } from "@workspace/ui/lib/utils"

import { STATUS_SOLID } from "@/components/quotes/quote-status-badge"
import { wholeMoney } from "@/lib/money"

type Outcomes = RouterOutputs["dashboard"]["overview"]["outcomes"]

/**
 * The customer win rate: Customer Approved out of every customer outcome,
 * as one hero figure over a meter, with each outcome's count and value
 * linking to its filtered Quote list.
 */
export function OutcomesCard({
  outcomes,
  currencyCode,
}: {
  outcomes: Outcomes
  currencyCode: string
}) {
  const rate = outcomes.winRate
  const decided = outcomes.won.count + outcomes.lost.count
  const rows = [
    {
      status: "customer_approved" as const,
      label: "Customer Approved",
      ...outcomes.won,
    },
    {
      status: "customer_rejected" as const,
      label: "Customer Rejected",
      ...outcomes.lost,
    },
  ]
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-baseline gap-2">
        <span className="figure text-5xl leading-none font-semibold">
          {rate === null ? "—" : `${new Decimal(rate).toFixed(0)} %`}
        </span>
        <span className="text-xs text-muted-foreground">
          {decided === 0
            ? "No customer outcomes yet"
            : `of ${decided} customer ${decided === 1 ? "outcome" : "outcomes"}`}
        </span>
      </div>
      <Progress
        value={rate === null ? 0 : Number(rate)}
        aria-label="Win rate"
        className="**:data-[slot=progress-indicator]:bg-success **:data-[slot=progress-track]:h-2 **:data-[slot=progress-track]:bg-danger-soft"
      />
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.status}>
            <Link
              href={`/quotes?status=${row.status}`}
              className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  STATUS_SOLID[row.status]
                )}
              />
              <span className="truncate">{row.label}</span>
              <span className="ml-auto font-medium tabular-nums">
                {row.count}
              </span>
              <span className="w-20 text-right text-muted-foreground tabular-nums">
                {wholeMoney(row.value, currencyCode)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <dl className="mt-auto grid grid-cols-2 gap-3 border-t pt-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Won value</dt>
          <dd className="figure text-xl font-semibold">
            {wholeMoney(outcomes.won.value, currencyCode)}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Average won Quote</dt>
          <dd className="figure text-xl font-semibold">
            {outcomes.won.count === 0
              ? "—"
              : wholeMoney(
                  new Decimal(outcomes.won.value)
                    .dividedBy(outcomes.won.count)
                    .toFixed(4),
                  currencyCode
                )}
          </dd>
        </div>
      </dl>
    </div>
  )
}
