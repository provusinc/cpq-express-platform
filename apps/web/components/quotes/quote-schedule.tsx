"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { ArrowRightIcon, CalendarCogIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import type { RouterOutputs } from "@workspace/api"
import { addDays, daysBetween, isIsoDate } from "@workspace/domain/dates"
import { TIME_PERIOD_LABELS, TIME_PERIODS } from "@workspace/domain/enums"
import type { TimePeriod } from "@workspace/domain/enums"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  RadioGroup,
  RadioGroupItem,
} from "@workspace/ui/components/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"

import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import { formatDate } from "@/lib/format"
import { formatMoney } from "@/lib/money"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { useQuoteCommand } from "./autosave"

type Quote = RouterOutputs["quote"]["byId"]
type Impact = RouterOutputs["quote"]["setDates"]["impact"]
type Mode = "shift" | "clamp"

/** Wait this long after the last keystroke before asking for a preview. */
const PREVIEW_DELAY_MS = 300

/**
 * The Quote Start / End Date editor: a button showing the dates that opens
 * a dialog. Moving the start is a Quote Shift by default (the end follows by
 * the same number of days) or a clamp; the end can then be moved too. The
 * impact (`quote.setDates` with `preview: true`, nothing persisted) shows
 * before "Apply", which runs the same command for real.
 */
export function QuoteDatesEditor({
  quote,
  disabled,
}: {
  quote: Quote
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const label = `${formatDate(quote.startDate)} – ${formatDate(quote.endDate)}`
  if (disabled) return <>{label}</>
  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded font-medium hover:underline"
        onClick={() => setOpen(true)}
        aria-label={`Change the Quote dates, ${label}`}
      >
        {label}
        <CalendarCogIcon className="size-3.5 text-muted-foreground" />
      </button>
      {open && (
        <QuoteDatesDialog quote={quote} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function QuoteDatesDialog({
  quote,
  onClose,
}: {
  quote: Quote
  onClose: () => void
}) {
  const trpc = useTRPC()
  const [startDate, setStartDate] = useState(quote.startDate)
  const [endDate, setEndDate] = useState(quote.endDate)
  const [endTouched, setEndTouched] = useState(false)
  const [mode, setMode] = useState<Mode>("shift")

  const startMoved = startDate !== quote.startDate
  const changed = startMoved || endDate !== quote.endDate
  const valid = isIsoDate(startDate) && isIsoDate(endDate)

  // Previews are plain mutations: nothing is saved, so they don't go
  // through useQuoteCommand (no "Saving…", no cache changes).
  const preview = useMutation(trpc.quote.setDates.mutationOptions())
  const { mutate: requestPreview, reset: resetPreview } = preview
  useEffect(() => {
    if (!changed || !valid) {
      resetPreview()
      return
    }
    const timer = setTimeout(
      () =>
        requestPreview({
          id: quote.id,
          startDate,
          endDate,
          mode,
          preview: true,
        }),
      PREVIEW_DELAY_MS
    )
    return () => clearTimeout(timer)
  }, [
    changed,
    valid,
    startDate,
    endDate,
    mode,
    quote.id,
    requestPreview,
    resetPreview,
  ])

  const apply = useQuoteCommand(
    quote.id,
    trpc.quote.setDates.mutationOptions(),
    {
      optimisticQuote: (_q, input) => ({
        startDate: input.startDate,
        endDate: input.endDate,
      }),
      onSuccess: (result) => {
        toast.success(
          result.impact.impactedCount === 0
            ? "Quote dates changed."
            : `Quote dates changed; ${result.impact.impactedCount} Line ${result.impact.impactedCount === 1 ? "Item" : "Items"} moved.`
        )
        onClose()
      },
    }
  )

  /** A Quote Shift moves the end with the start unless the end was edited. */
  const onStartChange = (value: string, nextMode = mode) => {
    setStartDate(value)
    if (endTouched || !isIsoDate(value)) return
    setEndDate(
      nextMode === "shift"
        ? addDays(quote.endDate, daysBetween(quote.startDate, value))
        : quote.endDate
    )
  }

  const impact = preview.data?.impact
  const previewError = preview.error ? errorMessage(preview.error) : null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quote dates</DialogTitle>
          <DialogDescription>
            Moving the start slides the whole Quote by default. Pulling a date
            in clamps the Line Items that overrun it; pushing it out changes
            nothing else.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!changed || !valid || previewError) return
            apply.mutate({ id: quote.id, startDate, endDate, mode })
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quote-start-date">Start date</Label>
              <Input
                id="quote-start-date"
                type="date"
                value={startDate}
                onChange={(e) => onStartChange(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quote-end-date">End date</Label>
              <Input
                id="quote-end-date"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndTouched(true)
                  setEndDate(e.target.value)
                }}
              />
            </div>
          </div>
          {startMoved && (
            <FieldSet className="gap-1.5">
              <FieldLegend variant="label" className="mb-0">
                Moving the start
              </FieldLegend>
              <RadioGroup
                value={mode}
                onValueChange={(value) => {
                  const next = value as typeof mode
                  setMode(next)
                  onStartChange(startDate, next)
                }}
                className="grid-cols-2"
              >
                {(
                  [
                    [
                      "shift",
                      "Shift everything",
                      "Lines, Allocations and the end move too; all Effort is kept.",
                    ],
                    [
                      "clamp",
                      "Clamp",
                      "Only the start moves; earlier work is cut.",
                    ],
                  ] as const
                ).map(([value, title, text]) => (
                  <FieldLabel key={value} htmlFor={`start-mode-${value}`}>
                    <Field orientation="horizontal" className="items-start">
                      <FieldContent className="gap-0.5">
                        <FieldTitle>{title}</FieldTitle>
                        <FieldDescription className="text-xs">
                          {text}
                        </FieldDescription>
                      </FieldContent>
                      <RadioGroupItem
                        value={value}
                        id={`start-mode-${value}`}
                      />
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldSet>
          )}
          <ImpactPreview
            changed={changed}
            pending={preview.isPending}
            error={previewError}
            impact={impact}
            currency={quote.currencyCode}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !changed || !valid || Boolean(previewError) || apply.isPending
              }
            >
              {apply.isPending ? "Applying…" : "Apply"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ImpactPreview({
  changed,
  pending,
  error,
  impact,
  currency,
}: {
  changed: boolean
  pending: boolean
  error: string | null
  impact: Impact | undefined
  currency: string
}) {
  if (!changed) return null
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    )
  }
  if (!impact) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {pending && (
          <Spinner className="size-3.5" role={undefined} aria-hidden />
        )}
        Working out the impact…
      </p>
    )
  }
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm"
      aria-live="polite"
    >
      <span className="font-medium">Impact</span>
      {impact.impactedCount === 0 ? (
        <span className="text-muted-foreground">No Line Items change.</span>
      ) : (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Line Items moved or cut</dt>
          <dd className="text-right tabular-nums">{impact.impactedCount}</dd>
          <dt className="text-muted-foreground">Clamped to the new dates</dt>
          <dd className="text-right tabular-nums">{impact.clampedCount}</dd>
          <dt className="text-muted-foreground">Losing Effort</dt>
          <dd
            className={
              impact.effortReducedCount > 0
                ? "text-right font-medium text-destructive tabular-nums"
                : "text-right tabular-nums"
            }
          >
            {impact.effortReducedCount}
          </dd>
        </dl>
      )}
      <div className="flex items-center justify-between border-t pt-2">
        <span className="text-muted-foreground">Total</span>
        <span className="flex items-center gap-1.5 tabular-nums">
          {formatMoney(impact.oldTotal, currency)}
          <ArrowRightIcon className="size-3.5 text-muted-foreground" />
          <span className="font-medium">
            {formatMoney(impact.newTotal, currency)}
          </span>
        </span>
      </div>
    </div>
  )
}

const TIME_PERIOD_ITEMS = TIME_PERIODS.map((value) => ({
  value,
  label: TIME_PERIOD_LABELS[value],
}))

/**
 * The Quote's Time Period, changeable in place. Changing it discards every
 * Allocation on the Quote, so it asks first (with how many there are).
 */
export function TimePeriodControl({
  quote,
  disabled,
}: {
  quote: Quote
  disabled?: boolean
}) {
  const trpc = useTRPC()
  const [pending, setPending] = useState<TimePeriod | null>(null)
  // Read (or fetch) the editor to count what would be discarded.
  const editor = useQuery({
    ...trpc.quote.editor.queryOptions({ id: quote.id }),
    enabled: pending !== null,
  }).data
  const planned = editor?.lines.filter((l) => l.plannerManaged) ?? []
  const cells = planned.reduce((n, l) => n + l.allocations.length, 0)

  const setTimePeriod = useQuoteCommand(
    quote.id,
    trpc.quote.setTimePeriod.mutationOptions(),
    {
      optimistic: (ed) => ({
        ...ed,
        lines: ed.lines.map((l) => ({
          ...l,
          plannerManaged: false,
          allocations: [],
        })),
      }),
      optimisticQuote: (_q, input) => ({ timePeriod: input.timePeriod }),
      onSuccess: (result) =>
        toast.success(
          result.discardedAllocations > 0
            ? `Time Period changed; ${result.discardedAllocations} Allocations discarded.`
            : "Time Period changed."
        ),
    }
  )

  if (disabled) return <>{TIME_PERIOD_LABELS[quote.timePeriod]}</>
  return (
    <>
      <Select
        items={TIME_PERIOD_ITEMS}
        value={quote.timePeriod}
        onValueChange={(v) => v && v !== quote.timePeriod && setPending(v)}
      >
        <SelectTrigger
          size="sm"
          aria-label="Time period"
          className="-ml-1.5 h-7 border-transparent bg-transparent px-1.5 font-medium shadow-none hover:border-input dark:bg-transparent"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TIME_PERIOD_ITEMS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={`Change the Time Period to ${pending ? TIME_PERIOD_LABELS[pending] : ""}?`}
        description={
          <>
            This discards <strong>all Allocations</strong> on the Quote
            {editor
              ? cells > 0
                ? ` (${cells} across ${planned.length} Line ${planned.length === 1 ? "Item" : "Items"})`
                : " (there are none yet)"
              : ""}
            . Line Items keep their quantities, and the Resource Planner lays
            them out again by the new period.
          </>
        }
        confirmLabel="Change and discard"
        onConfirm={() => {
          if (pending)
            setTimePeriod.mutate({ id: quote.id, timePeriod: pending })
          setPending(null)
        }}
      />
    </>
  )
}
