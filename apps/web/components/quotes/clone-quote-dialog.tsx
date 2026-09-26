"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

const cloneSchema = z.object({
  customerId: z.string().min(1, "Choose a Customer."),
  refreshRates: z.boolean(),
})
type CloneValues = z.infer<typeof cloneSchema>

/** The Quote being cloned: what the dialog shows and preselects. */
export interface CloneSource {
  id: string
  name: string
  customer: { id: string; name: string; archived?: boolean }
}

const defaults = (
  customer: Pick<CloneSource["customer"], "id" | "archived">
): CloneValues => ({
  // An archived Customer can't be quoted, so make the user choose.
  customerId: customer.archived ? "" : customer.id,
  refreshRates: false,
})

/**
 * Clone a Quote: "Copy of {name}" in Draft, owned by the caller, for the
 * same or another unarchived Customer, optionally re-priced from the
 * current catalog. Opens the new Quote.
 */
export function CloneQuoteDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: CloneSource
}) {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()
  const form = useForm<CloneValues>({
    resolver: zodResolver(cloneSchema),
    defaultValues: defaults(source.customer),
  })

  const { id: customerId, archived } = source.customer
  useEffect(() => {
    if (open) form.reset(defaults({ id: customerId, archived }))
  }, [open, customerId, archived, form])

  const customers = useQuery({
    ...trpc.customer.listForPicker.queryOptions({ limit: 100 }),
    enabled: open,
  })
  const customerItems = (customers.data ?? [])
    .filter((a) => !a.archived)
    .map((a) => ({ value: a.id, label: a.name }))

  const clone = useMutation(
    trpc.quote.clone.mutationOptions({
      onSuccess: async (quote) => {
        toast.success(`Quote “${quote.name}” created.`)
        await queryClient.invalidateQueries(trpc.quote.list.pathFilter())
        await queryClient.invalidateQueries(trpc.quote.insights.pathFilter())
        await queryClient.invalidateQueries(trpc.dashboard.pathFilter())
        onOpenChange(false)
        router.push(`/quotes/${quote.id}`)
      },
      onError: (error) =>
        form.setError("root", { message: errorMessage(error) }),
    })
  )

  const onSubmit = form.handleSubmit((values) =>
    clone.mutate({
      id: source.id,
      customerId: values.customerId,
      refreshRates: values.refreshRates,
    })
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clone Quote</DialogTitle>
          <DialogDescription>
            Creates “Copy of {source.name}” in Draft, owned by you, with its
            Line Items, plan, Milestones and Quote Discount. Approval history
            and Quote Documents stay with the original.
          </DialogDescription>
        </DialogHeader>
        <form id="clone-quote-form" onSubmit={onSubmit}>
          <FieldGroup>
            <Controller
              name="customerId"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="clone-customerId">Customer</FieldLabel>
                  <Select
                    items={customerItems}
                    value={field.value || null}
                    onValueChange={(v) => field.onChange(v ?? "")}
                  >
                    <SelectTrigger
                      id="clone-customerId"
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
                  {source.customer.archived && (
                    <FieldDescription>
                      {source.customer.name} is archived, so choose another
                      Customer.
                    </FieldDescription>
                  )}
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              name="refreshRates"
              control={form.control}
              render={({ field }) => (
                <Field orientation="horizontal">
                  <Checkbox
                    id="clone-refreshRates"
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true)
                    }
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="clone-refreshRates">
                      Refresh prices and costs from the catalog
                    </FieldLabel>
                    <FieldDescription>
                      Uses today&apos;s prices and costs. Negotiated prices and
                      lines whose item is inactive keep their values.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              )}
            />
            {form.formState.errors.root && (
              <FieldError errors={[form.formState.errors.root]} />
            )}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={clone.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="clone-quote-form"
            disabled={clone.isPending}
          >
            {clone.isPending ? "Cloning…" : "Clone Quote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
