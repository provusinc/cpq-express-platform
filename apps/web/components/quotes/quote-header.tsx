"use client"

import { CalendarX2Icon, LockIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { QUOTE_STATUS_LABELS } from "@workspace/domain/enums"
import { Decimal } from "@workspace/domain/money"
import { QUOTE_NAME_MAX } from "@workspace/domain/quotes"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

import {
  compactHours,
  initials,
  marginTone,
  quoteDuration,
} from "@/lib/figures"
import { formatDate } from "@/lib/format"
import { wholeMoney } from "@/lib/money"
import { useTRPC } from "@/trpc/react"

import { useQuoteCommand } from "./autosave"
import { InlineText } from "./inline-text"
import { QuoteDiscountControl } from "./quote-discount"
import { QuoteHeaderActions } from "./quote-actions"
import { WithQuoteFigures } from "./quote-figures"
import type { QuoteFigures } from "./quote-figures"
import { QuoteDatesEditor, TimePeriodControl } from "./quote-schedule"
import { QuoteStatusBadge } from "./quote-status-badge"
import { useQuote } from "./use-quote"
import type { Quote } from "./use-quote"

/**
 * The metrics strip's id (a stable element: the figures inside re-render once
 * hydrated): the tab bar shows a compact Total once it scrolls away.
 */
export const QUOTE_METRICS_ID = "quote-metrics"

/**
 * The header commands (`quote.rename`, `quote.setDescription`), each saving
 * one field through `useQuoteCommand`: applied optimistically to the cached
 * Quote and rolled back with a toast when the server refuses.
 */
function useHeaderCommands(quoteId: string) {
  const trpc = useTRPC()
  const rename = useQuoteCommand(quoteId, trpc.quote.rename.mutationOptions(), {
    optimisticQuote: (_quote, input) => ({ name: input.name }),
  })
  const setDescription = useQuoteCommand(
    quoteId,
    trpc.quote.setDescription.mutationOptions(),
    {
      optimisticQuote: (_quote, input) => ({ description: input.description }),
    }
  )
  return { rename, setDescription }
}

/** Why the viewer sees the Quote read-only. */
function ReadOnlyNotice({ quote }: { quote: Quote }) {
  const denial = quote.permissions.editDenial
  if (!denial) return null
  if (denial.reason === "locked") {
    return (
      <Alert>
        <LockIcon />
        <AlertTitle>
          Locked while {QUOTE_STATUS_LABELS[quote.status]}
        </AlertTitle>
        <AlertDescription>
          {quote.status === "customer_approved"
            ? "Customer Approved is final: this Quote can no longer change."
            : quote.status === "pending_approval"
              ? "It can't be edited while it awaits approval. Recalling it returns it to Draft."
              : "Committed Quotes can't be edited. Clone it to make changes."}
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert>
      <LockIcon />
      <AlertTitle>Read only</AlertTitle>
      <AlertDescription>{denial.message}</AlertDescription>
    </Alert>
  )
}

/**
 * The Quote editor's header, kept compact: the Customer's monogram beside
 * the Name (edited in place) with the meta line under it (status, Customer,
 * Owner, Valid Until) and the Description as one muted line when there is
 * one (else "Add a description" in the "…" menu), the actions at the right
 * (`QuoteHeaderActions`); then the metrics strip — Total, Margin %, Effort
 * (with the Time Period) and Duration (with the Quote dates editor). A
 * read-only notice explains when the viewer can't edit. Every figure
 * appears once: the tab bar only repeats Total and Margin once the strip
 * has scrolled away.
 */
export function QuoteHeader({ quoteId }: { quoteId: string }) {
  const quote = useQuote(quoteId)
  const { rename, setDescription } = useHeaderCommands(quoteId)
  const canEdit = quote.permissions.canEdit
  const [addingDescription, setAddingDescription] = useState(false)
  const showDescription = Boolean(quote.description) || addingDescription

  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Avatar
          className="mt-0.5 size-10 rounded-lg after:rounded-lg max-sm:hidden"
          aria-hidden
        >
          <AvatarFallback className="rounded-lg bg-accent text-sm font-semibold tracking-wide text-accent-foreground">
            {initials(quote.customer.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="-ml-2">
            <InlineText
              label="Name"
              value={quote.name}
              required
              maxLength={QUOTE_NAME_MAX}
              disabled={!canEdit}
              className="py-0 text-xl leading-7 font-semibold tracking-[-0.015em]"
              onSave={(name) => name && rename.mutate({ id: quote.id, name })}
            />
          </div>
          <MetaLine quote={quote} />
          {showDescription && (
            <div className="-ml-2 max-w-[80ch]">
              <InlineText
                label="Description"
                value={quote.description}
                multiline
                maxLength={2000}
                disabled={!canEdit}
                autoFocus={addingDescription && !quote.description}
                placeholder="Add a description"
                className="h-6 resize-none overflow-hidden py-0.5 text-sm text-muted-foreground focus:field-sizing-content focus:h-auto"
                onSave={(description) => {
                  setAddingDescription(false)
                  setDescription.mutate({ id: quote.id, description })
                }}
              />
            </div>
          )}
        </div>
        <div className="shrink-0">
          <QuoteHeaderActions
            quote={quote}
            onAddDescription={
              canEdit && !showDescription
                ? () => setAddingDescription(true)
                : undefined
            }
          />
        </div>
      </div>
      <div id={QUOTE_METRICS_ID}>
        <WithQuoteFigures quoteId={quoteId}>
          {(figures) => (
            <QuoteMetrics quote={quote} figures={figures} canEdit={canEdit} />
          )}
        </WithQuoteFigures>
      </div>
      <ReadOnlyNotice quote={quote} />
    </header>
  )
}

/** Status · Customer · Owner · Valid Until, one quiet line under the Name. */
function MetaLine({ quote }: { quote: Quote }) {
  const owner = quote.owner.name ?? quote.owner.email
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <QuoteStatusBadge status={quote.status} className="shrink-0" />
      <Dot />
      <Link
        href={`/customers/${quote.customer.id}`}
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        {quote.customer.name}
      </Link>
      {quote.customer.archived && <Badge variant="secondary">Archived</Badge>}
      <Dot />
      <span>
        Owner <span className="text-foreground">{owner}</span>
        {!quote.owner.isMember && " (no longer a member)"}
      </span>
      <Dot />
      {quote.validUntil ? (
        <span
          className={cn(
            quote.validUntilPassed &&
              "inline-flex items-center gap-1 font-medium text-danger-ink"
          )}
        >
          {quote.validUntilPassed && (
            <CalendarX2Icon className="size-3.5" aria-hidden />
          )}
          Valid Until{" "}
          <span className={cn(!quote.validUntilPassed && "text-foreground")}>
            {formatDate(quote.validUntil)}
          </span>
          {quote.validUntilPassed && " (passed)"}
        </span>
      ) : (
        <span>No Valid Until</span>
      )}
    </div>
  )
}

function Dot() {
  return (
    <span aria-hidden className="text-muted-foreground/50">
      ·
    </span>
  )
}

const TONE_INK = {
  success: "text-success-ink",
  warning: "text-warning-ink",
  danger: "text-danger-ink",
  neutral: "",
} as const

/**
 * The headline figures as one strip, divided by hairlines, each a figure
 * with its label and a detail line beside it: Total (and the Quote
 * Discount it is after, which opens the discount editor), Margin % (success
 * at or above the low-margin line, warning below it, danger negative; the
 * amount under it), Effort in hours (with the Time Period it is planned
 * in) and Duration in weeks (with the Quote dates, which open the dates
 * editor).
 */
function QuoteMetrics({
  quote,
  figures,
  canEdit,
}: {
  quote: Quote
  figures: QuoteFigures
  canEdit: boolean
}) {
  const currency = figures.currencyCode
  const tone = marginTone(figures.total, figures.marginPct)
  const duration = quoteDuration(quote.startDate, quote.endDate)
  return (
    <dl
      aria-label="Quote figures"
      className="flex flex-wrap items-center gap-y-3"
    >
      <Metric
        label="Total"
        sub={
          <QuoteDiscountControl
            quoteId={quote.id}
            figures={figures}
            canEdit={canEdit}
          />
        }
      >
        {wholeMoney(figures.total, currency)}
      </Metric>
      <Metric
        label="Margin"
        sub={`${wholeMoney(figures.margin, currency)} on ${wholeMoney(figures.cost, currency)} cost`}
      >
        <span className={TONE_INK[tone]}>
          {new Decimal(figures.marginPct).toFixed(1)}
          <Unit>%</Unit>
        </span>
      </Metric>
      <Metric
        label="Effort"
        sub={
          <span className="inline-flex items-center gap-1">
            Planned in
            <TimePeriodControl
              quote={quote}
              disabled={!canEdit}
              className="h-5 text-xs text-foreground"
            />
          </span>
        }
      >
        {compactHours(figures.effortHours)}
        <Unit>h</Unit>
      </Metric>
      <Metric
        label="Duration"
        sub={
          <QuoteDatesEditor
            quote={quote}
            disabled={!canEdit}
            className="text-xs text-foreground"
          />
        }
      >
        {duration.value}
        <Unit>{duration.unit}</Unit>
      </Metric>
    </dl>
  )
}

/** A figure with its label above its detail line, both to its right. */
function Metric({
  label,
  sub,
  children,
}: {
  label: string
  sub: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_auto] grid-rows-[auto_auto] items-center gap-x-2.5 border-l px-5 first:border-l-0 first:pl-0">
      <dt className="col-start-2 row-start-1 text-xs leading-4 text-muted-foreground">
        {label}
      </dt>
      <dd className="figure col-start-1 row-span-2 row-start-1 text-2xl leading-none font-semibold">
        {children}
      </dd>
      <dd className="col-start-2 row-start-2 flex h-5 items-center text-xs whitespace-nowrap text-muted-foreground">
        {sub}
      </dd>
    </div>
  )
}

function Unit({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-0.5 font-sans text-sm font-medium text-muted-foreground">
      {children}
    </span>
  )
}

/** Total and Margin % in one line: the tab bar's reminder once the metrics scroll away. */
export function CompactQuoteFigures({ figures }: { figures: QuoteFigures }) {
  const tone = marginTone(figures.total, figures.marginPct)
  return (
    <dl className="flex items-baseline gap-4 text-sm whitespace-nowrap">
      <div className="flex items-baseline gap-1.5">
        <dt className="text-xs text-muted-foreground">Margin</dt>
        <dd className={cn("figure font-medium", TONE_INK[tone])}>
          {new Decimal(figures.marginPct).toFixed(1)}%
        </dd>
      </div>
      <div className="flex items-baseline gap-1.5">
        <dt className="text-xs text-muted-foreground">Total</dt>
        <dd className="figure text-base font-semibold">
          {wholeMoney(figures.total, figures.currencyCode)}
        </dd>
      </div>
    </dl>
  )
}
