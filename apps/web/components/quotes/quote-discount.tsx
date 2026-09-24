"use client"

import { ChevronDownIcon, XIcon } from "lucide-react"
import { useState } from "react"

import type { DiscountKind } from "@workspace/domain/enums"
import { Decimal, toPercentString } from "@workspace/domain/money"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"

import { formatMoney, isMoneyInput, trimMoney, wholeMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

import { useQuoteCommand } from "./autosave"
import { InlineText } from "./inline-text"
import type { QuoteFigures } from "./quote-figures"

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

/** "No Quote Discount", "−5% Quote Discount" or "−$1,200 Quote Discount". */
export function discountLine(figures: QuoteFigures) {
  if (new Decimal(figures.discountAmount).isZero()) return "No Quote Discount"
  return figures.discountKind === "percent" && figures.discountValue
    ? `−${trimMoney(figures.discountValue)}% Quote Discount`
    : `−${wholeMoney(figures.discountAmount, figures.currencyCode)} Quote Discount`
}

/** `quote.setDiscount`, applied optimistically to the editor and the Quote. */
function useSetDiscount(quoteId: string) {
  const trpc = useTRPC()
  return useQuoteCommand(quoteId, trpc.quote.setDiscount.mutationOptions(), {
    optimistic: (editor, input) => ({
      ...editor,
      totals: {
        ...editor.totals,
        discountKind: input.discount?.kind ?? null,
        discountValue:
          input.discount === null ? null : String(input.discount.value),
      },
    }),
    optimisticQuote: (_quote, input) => ({
      discountKind: input.discount?.kind ?? null,
      discountValue:
        input.discount === null ? null : String(input.discount.value),
    }),
  })
}

/**
 * The Total metric's detail line. For an editor it opens a small popover
 * with the Quote Discount editor — entered as % or amount (switching keeps
 * the same reduction), cleared with ×; each change is one
 * `quote.setDiscount` command. Read-only viewers get the plain text.
 */
export function QuoteDiscountControl({
  quoteId,
  figures,
  canEdit,
}: {
  quoteId: string
  figures: QuoteFigures
  canEdit: boolean
}) {
  const text = discountLine(figures)
  if (!canEdit) return <span>{text}</span>
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="-ml-1.5 h-5 gap-0.5 px-1.5 text-xs font-normal text-foreground"
          />
        }
      >
        {text}
        <ChevronDownIcon className="size-3 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Quote Discount</PopoverTitle>
          <PopoverDescription>
            Off the Subtotal of{" "}
            {formatMoney(figures.subtotal, figures.currencyCode)}.
          </PopoverDescription>
        </PopoverHeader>
        <DiscountEditor quoteId={quoteId} figures={figures} />
      </PopoverContent>
    </Popover>
  )
}

function DiscountEditor({
  quoteId,
  figures,
}: {
  quoteId: string
  figures: QuoteFigures
}) {
  const setDiscount = useSetDiscount(quoteId)
  const save = (discount: { kind: DiscountKind; value: string } | null) =>
    setDiscount.mutate({ id: quoteId, discount })
  const currency = figures.currencyCode
  // How a new discount will be entered, until one is set.
  const [chosenKind, setChosenKind] = useState<DiscountKind>("percent")
  const kind: DiscountKind = figures.discountKind ?? chosenKind

  const switchKind = (next: DiscountKind) => {
    setChosenKind(next)
    if (!figures.discountKind || next === figures.discountKind) return
    // Keep the same reduction, expressed the other way.
    const subtotal = new Decimal(figures.subtotal)
    save({
      kind: next,
      value:
        next === "amount"
          ? trimMoney(figures.discountAmount)
          : subtotal.isZero()
            ? "0"
            : trimMoney(
                toPercentString(
                  Decimal.min(
                    100,
                    new Decimal(figures.discountAmount).div(subtotal).times(100)
                  )
                )
              ),
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ToggleGroup
          aria-label="Discount kind"
          variant="outline"
          size="sm"
          value={[kind]}
          onValueChange={(values) => {
            const next = values[0] as DiscountKind | undefined
            if (next && next !== kind) switchKind(next)
          }}
        >
          <ToggleGroupItem value="percent" aria-label="Percent">
            %
          </ToggleGroupItem>
          <ToggleGroupItem value="amount" aria-label={`Amount in ${currency}`}>
            {currency}
          </ToggleGroupItem>
        </ToggleGroup>
        <InlineText
          label={kind === "percent" ? "Discount %" : "Discount amount"}
          value={
            figures.discountValue !== null
              ? trimMoney(figures.discountValue)
              : null
          }
          inputMode="decimal"
          placeholder="None"
          validate={(v) => discountProblem(kind, v)}
          className="h-8 flex-1 border-input text-right tabular-nums"
          onSave={(value) => save(value === null ? null : { kind, value })}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Remove the Quote Discount"
          disabled={!figures.discountKind}
          onClick={() => save(null)}
        >
          <XIcon />
        </Button>
      </div>
      {figures.discountKind && (
        <p className="text-xs text-muted-foreground tabular-nums">
          −{formatMoney(figures.discountAmount, currency)} · Total{" "}
          {formatMoney(figures.total, currency)}
        </p>
      )}
    </div>
  )
}
