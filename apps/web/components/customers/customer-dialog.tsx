"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import type { RouterOutputs } from "@workspace/api"
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
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"

import { errorCode, errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

type Customer = RouterOutputs["customer"]["byId"]

const customerSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200),
  type: z.string().max(100),
  industry: z.string().max(100),
  website: z.string().max(500),
  phone: z.string().max(50),
  billingStreet: z.string().max(500),
  billingCity: z.string().max(100),
  billingState: z.string().max(100),
  billingPostalCode: z.string().max(20),
  billingCountry: z.string().max(100),
})
type CustomerValues = z.infer<typeof customerSchema>

const FIELDS: { name: keyof CustomerValues; label: string; wide?: boolean }[] =
  [
    { name: "type", label: "Type" },
    { name: "industry", label: "Industry" },
    { name: "website", label: "Website" },
    { name: "phone", label: "Phone" },
  ]
const ADDRESS: { name: keyof CustomerValues; label: string; wide?: boolean }[] =
  [
    { name: "billingStreet", label: "Street", wide: true },
    { name: "billingCity", label: "City" },
    { name: "billingState", label: "State / region" },
    { name: "billingPostalCode", label: "Postal code" },
    { name: "billingCountry", label: "Country" },
  ]

function toValues(customer?: Customer | null): CustomerValues {
  return {
    name: customer?.name ?? "",
    type: customer?.type ?? "",
    industry: customer?.industry ?? "",
    website: customer?.website ?? "",
    phone: customer?.phone ?? "",
    billingStreet: customer?.billingStreet ?? "",
    billingCity: customer?.billingCity ?? "",
    billingState: customer?.billingState ?? "",
    billingPostalCode: customer?.billingPostalCode ?? "",
    billingCountry: customer?.billingCountry ?? "",
  }
}

/**
 * Create or edit a Customer. With `customer`, edits it; otherwise creates
 * one and calls `onCreated`. A duplicate name shows on the name field.
 */
export function CustomerDialog({
  open,
  onOpenChange,
  customer,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer?: Customer | null
  onCreated?: (customer: { id: string; name: string }) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const form = useForm<CustomerValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: toValues(customer),
  })

  useEffect(() => {
    if (open) form.reset(toValues(customer))
  }, [open, customer, form])

  const onDone = async () => {
    await queryClient.invalidateQueries(trpc.customer.pathFilter())
    onOpenChange(false)
  }
  const onError = (error: unknown) => {
    if (errorCode(error) === "CONFLICT") {
      form.setError("name", { message: errorMessage(error) })
    } else {
      toast.error(errorMessage(error))
    }
  }
  const create = useMutation(
    trpc.customer.create.mutationOptions({
      onSuccess: async (created) => {
        toast.success(`Customer “${created.name}” created.`)
        await onDone()
        onCreated?.(created)
      },
      onError,
    })
  )
  const update = useMutation(
    trpc.customer.update.mutationOptions({
      onSuccess: async () => {
        toast.success("Customer saved.")
        await onDone()
      },
      onError,
    })
  )
  const pending = create.isPending || update.isPending

  const onSubmit = form.handleSubmit((values) => {
    if (customer) update.mutate({ id: customer.id, ...values })
    else create.mutate(values)
  })

  const renderField = ({
    name,
    label,
    wide,
  }: {
    name: keyof CustomerValues
    label: string
    wide?: boolean
  }) => (
    <Controller
      key={name}
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field
          data-invalid={fieldState.invalid}
          className={wide ? "sm:col-span-2" : undefined}
        >
          <FieldLabel htmlFor={`customer-${name}`}>{label}</FieldLabel>
          <Input
            {...field}
            id={`customer-${name}`}
            aria-invalid={fieldState.invalid}
            autoComplete="off"
          />
          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {customer ? "Edit Customer" : "New Customer"}
          </DialogTitle>
          <DialogDescription>
            Customer names are unique in your Organization.
          </DialogDescription>
        </DialogHeader>
        <form
          id="customer-form"
          onSubmit={onSubmit}
          className="max-h-[65vh] overflow-y-auto"
        >
          <FieldGroup>
            {renderField({ name: "name", label: "Name", wide: true })}
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELDS.map(renderField)}
            </div>
            <FieldSet>
              <FieldLegend variant="label">Billing address</FieldLegend>
              <div className="grid gap-4 sm:grid-cols-2">
                {ADDRESS.map(renderField)}
              </div>
            </FieldSet>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" form="customer-form" disabled={pending}>
            {pending ? "Saving…" : customer ? "Save" : "Create Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
