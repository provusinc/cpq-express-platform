"use client"

import { XIcon } from "lucide-react"
import { useState } from "react"

import type { DiscountKind } from "@workspace/domain/enums"
import { Decimal, toPercentString } from "@workspace/domain/money"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

import type { EditorTotals } from "@/components/quotes/autosave"
import { InlineText } from "@/components/quotes/inline-text"
import { formatMoney, isMoneyInput, trimMoney } from "@/lib/money"

const PERCENT_INPUT = /^\d{1,3}(\.\d{1,4})?$/

/** Why a typed discount is invalid, or null. */
function discountProblem(kind: DiscountKind, value: string) {
  if (kind === "percent") {
    return PERCENT_INPUT.test(value) &&
      new Decimal(value).lessThanOrEqualTo(100)
      ? null
      : "Enter a percentage from 0 to 100 with up to 4 decimals."
  }
  return isMoneyInput(value)
    ? null
    : "Enter an amount of 0 or more with up to 4 decimals."
}

/**
 * The Quote's money as the server computed it: Subtotal, Quote Discount
 * (entered as % or amount, editable in place), Total, cost, Margin and
 * Margin %. Changing the discount is one `quote.setDiscount` command;
 * clearing the value removes it.
 */
export function QuoteSummary({
  totals,
  readOnly,
  onSetDiscount,
}: {
  totals: EditorTotals
  readOnly: boolean
  onSetDiscount: (
    discount: { kind: DiscountKind; value: string } | null
  ) => void
}) {
  const currency = totals.currencyCode
  const money = (amount: string) => formatMoney(amount, currency)
  // How a new discount will be entered, until one is set.
  const [chosenKind, setChosenKind] = useState<DiscountKind>("percent")
  const kind: DiscountKind = totals.discountKind ?? chosenKind
  const negativeMargin = totals.margin.startsWith("-")

  const switchKind = (next: DiscountKind) => {
    setChosenKind(next)
    if (!totals.discountKind || next === totals.discountKind) return
    // Keep the same reduction, expressed the other way.
    const subtotal = new Decimal(totals.subtotal)
    onSetDiscount({
      kind: next,
      value:
        next === "amount"
          ? trimMoney(totals.discountAmount)
          : subtotal.isZero()
            ? "0"
            : trimMoney(
                toPercentString(
                  Decimal.min(
                    100,
                    new Decimal(totals.discountAmount).div(subtotal).times(100)
                  )
                )
              ),
    })
  }

  return (
    <Card size="sm" className="w-full shrink-0 self-end sm:w-80">
      <CardHeader>
        <CardTitle>Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2 text-sm">
          <Row label="Subtotal">{money(totals.subtotal)}</Row>
          <div className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-1 text-muted-foreground">
              Discount
              <span className="inline-flex rounded-md border p-0.5">
                {(["percent", "amount"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={readOnly}
                    aria-pressed={kind === k}
                    onClick={() => switchKind(k)}
                    className={cn(
                      "rounded px-1.5 text-xs",
                      kind === k
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {k === "percent" ? "%" : currency}
                  </button>
                ))}
              </span>
            </dt>
            <dd className="flex items-center gap-1">
              <InlineText
                label={kind === "percent" ? "Discount %" : "Discount amount"}
                value={
                  totals.discountValue !== null
                    ? trimMoney(totals.discountValue)
                    : null
                }
                inputMode="decimal"
                placeholder={readOnly ? "—" : "None"}
                disabled={readOnly}
                validate={(v) => discountProblem(kind, v)}
                className="w-24 text-right tabular-nums"
                onSave={(value) =>
                  onSetDiscount(value === null ? null : { kind, value })
                }
              />
              {totals.discountKind && !readOnly && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove the discount"
                  onClick={() => onSetDiscount(null)}
                >
                  <XIcon />
                </Button>
              )}
            </dd>
          </div>
          {totals.discountKind && (
            <Row label="Discount amount" muted>
              −{money(totals.discountAmount)}
            </Row>
          )}
          <div className="my-1 border-t" />
          <Row label="Total" strong>
            {money(totals.total)}
          </Row>
          <Row label="Cost" muted>
            {money(totals.cost)}
          </Row>
          <Row label="Margin">
            <span className={cn(negativeMargin && "text-destructive")}>
              {money(totals.margin)}
            </span>
          </Row>
          <Row label="Margin %">
            <span className={cn(negativeMargin && "text-destructive")}>
              {trimMoney(totals.marginPct)}%
            </span>
          </Row>
        </dl>
      </CardContent>
    </Card>
  )
}

function Row({
  label,
  children,
  strong,
  muted,
}: {
  label: string
  children: React.ReactNode
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className={cn("text-muted-foreground", strong && "text-foreground")}>
        {label}
      </dt>
      <dd
        className={cn(
          "tabular-nums",
          strong && "figure text-xl leading-6 font-semibold",
          muted && "text-muted-foreground"
        )}
      >
        {children}
      </dd>
    </div>
  )
}
