"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { CalendarX2Icon, LockIcon } from "lucide-react"
import Link from "next/link"

import type { RouterOutputs } from "@workspace/api"
import { QUOTE_STATUS_LABELS } from "@workspace/domain/enums"
import { QUOTE_NAME_MAX } from "@workspace/domain/quotes"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

import { formatDate } from "@/lib/format"
import { useTRPC } from "@/trpc/react"

import { QUOTE_POLL_MS, QuoteSaveIndicator, useQuoteCommand } from "./autosave"
import { InlineText } from "./inline-text"
import { QuoteHeaderActions } from "./quote-actions"
import { QuoteDatesEditor, TimePeriodControl } from "./quote-schedule"
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
 * The Quote editor's header: status and Name (edited in place), the
 * Description, the actions at the top right (`actions`: approval actions,
 * #19, before Clone and the menu with Delete, `QuoteHeaderActions`), and a
 * spec row with Account, Owner, the Quote dates (`QuoteDatesEditor`:
 * shift/clamp with an impact preview), Valid Until and Time Period
 * (`TimePeriodControl`: warns, then discards all Allocations). A read-only
 * notice explains when the viewer can't edit.
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-96 flex-col gap-1">
          <div className="flex items-center gap-2">
            <QuoteStatusBadge status={quote.status} className="shrink-0" />
            <QuoteSaveIndicator quoteId={quoteId} />
          </div>
          <div className="-ml-2">
            <InlineText
              label="Name"
              value={quote.name}
              required
              maxLength={QUOTE_NAME_MAX}
              disabled={!canEdit}
              className="text-2xl leading-tight font-semibold tracking-[-0.015em]"
              onSave={(name) => name && rename.mutate({ id: quote.id, name })}
            />
          </div>
          <div className="-mt-0.5 -ml-2 max-w-[80ch]">
            <InlineText
              label="Description"
              value={quote.description}
              multiline
              maxLength={2000}
              disabled={!canEdit}
              placeholder={canEdit ? "Add a description" : "No description"}
              className="resize-none py-0.5 text-sm text-muted-foreground"
              onSave={(description) =>
                setDescription.mutate({ id: quote.id, description })
              }
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <QuoteHeaderActions
            quote={quote}
            canDelete={quote.permissions.canDelete}
          />
        </div>
      </div>
      <dl className="grid grid-cols-2 overflow-hidden rounded-lg border bg-muted/40 text-sm sm:grid-cols-3 xl:flex xl:flex-wrap">
        <Meta label="Account" className="xl:min-w-56">
          <Link
            href={`/accounts/${quote.account.id}`}
            className="truncate font-medium underline-offset-4 hover:underline"
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
          <span className="truncate">
            {quote.owner.name ?? quote.owner.email}
          </span>
          {!quote.owner.isMember && (
            <span className="ml-1 text-muted-foreground">
              (no longer a member)
            </span>
          )}
        </Meta>
        <Meta label="Dates" className="xl:min-w-60">
          <QuoteDatesEditor quote={quote} disabled={!canEdit} />
        </Meta>
        <Meta label="Valid Until">
          {quote.validUntil ? (
            <span
              className={
                quote.validUntilPassed
                  ? "inline-flex items-center gap-1 font-medium text-danger-ink"
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
        <Meta label="Time period">
          <TimePeriodControl quote={quote} disabled={!canEdit} />
        </Meta>
      </dl>
      <ReadOnlyNotice quote={quote} />
    </div>
  )
}

/** One cell of the spec row: a small label over its value. */
function Meta({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "-mt-px -ml-px flex min-w-0 flex-col gap-0.5 border-t border-l px-3.5 py-2 xl:flex-1",
        className
      )}
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-h-7 min-w-0 items-center">{children}</dd>
    </div>
  )
}
