"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { TriangleAlertIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useDeferredValue, useEffect } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { addDays, compareDates, isIsoDate } from "@workspace/domain/dates"
import { TIME_PERIOD_LABELS, TIME_PERIODS } from "@workspace/domain/enums"
import { QUOTE_NAME_MAX, suggestQuoteName } from "@workspace/domain/quotes"
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import { todayIsoDate } from "@/lib/format"
import { errorMessage, fieldErrors } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

const isoDate = z.string().refine(isIsoDate, "Enter a date.")

const quoteSchema = z
  .object({
    customerId: z.string().min(1, "Choose a Customer."),
    name: z.string().trim().min(1, "Enter a name.").max(QUOTE_NAME_MAX),
    startDate: isoDate,
    endDate: isoDate,
    validUntil: z.union([z.literal(""), isoDate]),
    timePeriod: z.enum(TIME_PERIODS),
  })
  .superRefine((v, ctx) => {
    if (
      isIsoDate(v.startDate) &&
      isIsoDate(v.endDate) &&
      compareDates(v.endDate, v.startDate) < 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "The end date can't be before the start date.",
      })
    }
  })
type QuoteValues = z.infer<typeof quoteSchema>

const TIME_PERIOD_ITEMS = TIME_PERIODS.map((value) => ({
  value,
  label: TIME_PERIOD_LABELS[value],
}))

/** A new Quote's defaults: starts today, ~3 months long, valid 30 days. */
function defaultValues(customerId = ""): QuoteValues {
  const today = todayIsoDate()
  return {
    customerId,
    name: "",
    startDate: today,
    endDate: addDays(today, 90),
    validUntil: addDays(today, 30),
    timePeriod: "months",
  }
}

/**
 * New Quote: pick an unarchived Customer, a Name (prefilled with
 * "{Customer} – {Mon YYYY}" of the start date until the user types their
 * own), dates, Valid Until and Time Period. Warns — without blocking — when
 * the Customer already has a Quote with that Name. Opens the new Quote.
 */
export function CreateQuoteDialog({
  open,
  onOpenChange,
  customerId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preselect this Customer (e.g. from a Customer's page). */
  customerId?: string
}) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()
  const form = useForm<QuoteValues>({
    resolver: zodResolver(quoteSchema),
    defaultValues: defaultValues(customerId),
  })

  useEffect(() => {
    if (open) form.reset(defaultValues(customerId))
  }, [open, customerId, form])

  const customers = useQuery({
    ...trpc.customer.listForPicker.queryOptions({ limit: 100 }),
    enabled: open,
  })
  const customerItems = (customers.data ?? []).map((a) => ({
    value: a.id,
    label: a.name,
  }))

  const [selectedCustomerId, startDate, name] = useWatch({
    control: form.control,
    name: ["customerId", "startDate", "name"],
  })
  const customerName = customers.data?.find(
    (a) => a.id === selectedCustomerId
  )?.name

  // Keep the suggested Name in step until the user edits it.
  useEffect(() => {
    if (!open || form.getFieldState("name").isDirty) return
    if (!isIsoDate(startDate)) return
    form.setValue("name", suggestQuoteName(customerName, startDate))
  }, [open, customerName, startDate, form])

  const deferredName = useDeferredValue(name.trim())
  const nameTaken = useQuery({
    ...trpc.quote.nameTaken.queryOptions({
      customerId: selectedCustomerId,
      name: deferredName,
    }),
    enabled: open && Boolean(selectedCustomerId && deferredName),
  })

  const create = useMutation(
    trpc.quote.create.mutationOptions({
      onSuccess: async (quote) => {
        toast.success(`Quote “${quote.name}” created.`)
        await queryClient.invalidateQueries(trpc.quote.pathFilter())
        onOpenChange(false)
        router.push(`/quotes/${quote.id}/line-items`)
      },
      onError: (error) => {
        const fields = fieldErrors(error)
        const known = Object.keys(fields).filter((f) => f in quoteSchema.shape)
        for (const field of known) {
          form.setError(field as keyof QuoteValues, {
            message: fields[field],
          })
        }
        if (known.length === 0) {
          form.setError("root", { message: errorMessage(error) })
        }
      },
    })
  )

  const onSubmit = form.handleSubmit((values) =>
    create.mutate({ ...values, validUntil: values.validUntil || null })
  )

  const dateField = (
    field: "startDate" | "endDate" | "validUntil",
    label: string,
    description?: string
  ) => (
    <Controller
      name={field}
      control={form.control}
      render={({ field: f, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`quote-${field}`}>{label}</FieldLabel>
          <Input
            {...f}
            id={`quote-${field}`}
            type="date"
            aria-invalid={fieldState.invalid}
          />
          {description && <FieldDescription>{description}</FieldDescription>}
          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Quote</DialogTitle>
          <DialogDescription>
            You&apos;ll be its Quote Owner. Add Line Items once it&apos;s
            created.
          </DialogDescription>
        </DialogHeader>
        <form id="create-quote-form" onSubmit={onSubmit}>
          <FieldGroup>
            <Controller
              name="customerId"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="quote-customerId">Customer</FieldLabel>
                  <Select
                    items={customerItems}
                    value={field.value || null}
                    onValueChange={(v) => field.onChange(v ?? "")}
                  >
                    <SelectTrigger
                      id="quote-customerId"
                      className="w-full"
                      aria-invalid={fieldState.invalid}
                    >
                      <SelectValue
                        placeholder={
                          customers.isPending
                            ? "Loading Customers…"
                            : "Choose a Customer"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {customerItems.map((a) => (
                        <SelectItem key={a.value} value={a.value}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {customers.isSuccess && customerItems.length === 0 && (
                    <FieldDescription>
                      No Customers yet. Create one on the Customers page first.
                    </FieldDescription>
                  )}
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="quote-name">Name</FieldLabel>
                  <Input
                    {...field}
                    id="quote-name"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  {nameTaken.data?.taken && (
                    <p
                      role="status"
                      className="flex items-center gap-1.5 text-sm text-warning-ink"
                    >
                      <TriangleAlertIcon className="size-4 shrink-0" />
                      {customerName ?? "This Customer"} already has{" "}
                      {nameTaken.data.count === 1
                        ? "a Quote"
                        : `${nameTaken.data.count} Quotes`}{" "}
                      with this name. You can still create it.
                    </p>
                  )}
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {dateField("startDate", "Start date")}
              {dateField("endDate", "End date")}
              {dateField(
                "validUntil",
                "Valid Until",
                "Optional. Informational only."
              )}
              <Controller
                name="timePeriod"
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="quote-timePeriod">
                      Time period
                    </FieldLabel>
                    <Select
                      items={TIME_PERIOD_ITEMS}
                      value={field.value}
                      onValueChange={(v) => v && field.onChange(v)}
                    >
                      <SelectTrigger id="quote-timePeriod" className="w-full">
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
                    <FieldDescription>How effort is planned.</FieldDescription>
                  </Field>
                )}
              />
            </div>
            {form.formState.errors.root && (
              <FieldError errors={[form.formState.errors.root]} />
            )}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-quote-form"
            disabled={create.isPending}
          >
            {create.isPending ? "Creating…" : "Create Quote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
