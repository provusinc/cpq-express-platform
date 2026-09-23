"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { ArrowLeftIcon, CalendarX2Icon, LockIcon } from "lucide-react"
import Link from "next/link"

import type { RouterOutputs } from "@workspace/api"
import {
  QUOTE_STATUS_LABELS,
  TIME_PERIOD_LABELS,
} from "@workspace/domain/enums"
import { QUOTE_NAME_MAX } from "@workspace/domain/quotes"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"

import { formatDate } from "@/lib/format"
import { useTRPC } from "@/trpc/react"

import { QUOTE_POLL_MS, QuoteSaveIndicator, useQuoteCommand } from "./autosave"
import { InlineText } from "./inline-text"
import { QuoteStatusBadge } from "./quote-status-badge"

type Quote = RouterOutputs["quote"]["byId"]

/**
 * The open Quote: `quote.byId`, refetched on window focus and every 30 s.
 * Every editor component reads the Quote through this.
 */
export function useQuote(quoteId: string) {
  const trpc = useTRPC()
  return useSuspenseQuery({
    ...trpc.quote.byId.queryOptions({ id: quoteId }),
    refetchOnWindowFocus: true,
    refetchInterval: QUOTE_POLL_MS,
  }).data
}

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
 * The Quote editor's header: Name and Description (edited in place, each
 * saved as its own command), status, Account, Owner, dates and Time
 * Period, and a read-only notice when the viewer can't edit. `actions`
 * renders at the top right (approval actions, #19).
 */
export function QuoteHeader({
  quoteId,
  actions,
}: {
  quoteId: string
  actions?: React.ReactNode
}) {
  const quote = useQuote(quoteId)
  const { rename, setDescription } = useHeaderCommands(quoteId)
  const canEdit = quote.permissions.canEdit

  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/quotes"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Quotes
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="-ml-2 flex items-center gap-2">
            <InlineText
              label="Name"
              value={quote.name}
              required
              maxLength={QUOTE_NAME_MAX}
              disabled={!canEdit}
              className="text-xl font-semibold tracking-tight"
              onSave={(name) => name && rename.mutate({ id: quote.id, name })}
            />
            <QuoteStatusBadge status={quote.status} className="shrink-0" />
          </div>
          <div className="-ml-2">
            <InlineText
              label="Description"
              value={quote.description}
              multiline
              maxLength={2000}
              disabled={!canEdit}
              placeholder={canEdit ? "Add a description" : "No description"}
              className="resize-none text-sm text-muted-foreground"
              onSave={(description) =>
                setDescription.mutate({ id: quote.id, description })
              }
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <QuoteSaveIndicator quoteId={quoteId} />
          {actions}
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Meta label="Account">
          <Link
            href={`/accounts/${quote.account.id}`}
            className="font-medium hover:underline"
          >
            {quote.account.name}
          </Link>
          {quote.account.archived && (
            <Badge variant="secondary" className="ml-2">
              Archived
            </Badge>
          )}
        </Meta>
        <Meta label="Owner">
          {quote.owner.name ?? quote.owner.email}
          {!quote.owner.isMember && (
            <span className="ml-1 text-muted-foreground">
              (no longer a member)
            </span>
          )}
        </Meta>
        <Meta label="Dates">
          {formatDate(quote.startDate)} – {formatDate(quote.endDate)}
        </Meta>
        <Meta label="Valid until">
          {quote.validUntil ? (
            <span
              className={
                quote.validUntilPassed
                  ? "inline-flex items-center gap-1 font-medium text-destructive"
                  : undefined
              }
            >
              {quote.validUntilPassed && (
                <CalendarX2Icon className="size-3.5" aria-hidden />
              )}
              {formatDate(quote.validUntil)}
              {quote.validUntilPassed && " (passed)"}
            </span>
          ) : (
            "—"
          )}
        </Meta>
        <Meta label="Time period">{TIME_PERIOD_LABELS[quote.timePeriod]}</Meta>
      </dl>
      <ReadOnlyNotice quote={quote} />
    </div>
  )
}

function Meta({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center">{children}</dd>
    </div>
  )
}
