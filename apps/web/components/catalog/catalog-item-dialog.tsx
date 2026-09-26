"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import type { RouterOutputs } from "@workspace/api"
import {
  billingUnitsLabel,
  defaultBillingUnit,
} from "@workspace/domain/catalog"
import { BILLING_UNITS } from "@workspace/domain/enums"
import type { BillingUnit } from "@workspace/domain/enums"
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
import { Textarea } from "@workspace/ui/components/textarea"

import { isMoneyInput, trimMoney } from "@/lib/money"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import type { CatalogTypeView } from "@/components/shell/catalog-types"

import { savedMessage } from "./cost-propagation"
import { BILLING_UNIT_LABELS } from "./labels"

type CatalogItem = RouterOutputs["catalogItem"]["byId"]

const moneyField = z
  .string()
  .trim()
  .refine(isMoneyInput, "Enter an amount of 0 or more, up to 4 decimals.")

const itemSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200),
  description: z.string().max(2000),
  price: moneyField,
  cost: moneyField,
  billingUnit: z.enum(["each", "hour"]),
  tags: z.string().max(1000),
})
type ItemValues = z.infer<typeof itemSchema>

function toValues(
  type: CatalogTypeView,
  item?: CatalogItem | null
): ItemValues {
  return {
    name: item?.name ?? "",
    description: item?.description ?? "",
    price: item ? trimMoney(item.price) : "",
    cost: item ? trimMoney(item.cost) : "",
    billingUnit: item?.billingUnit ?? defaultBillingUnit(type),
    tags: item?.tags.join(", ") ?? "",
  }
}

const splitTags = (tags: string) =>
  tags
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean)

/**
 * Create or edit an item of a Catalog Type (Admins only; the API re-checks),
 * billed by one of the type's Billing Units.
 */
export function CatalogItemDialog({
  catalogType,
  open,
  onOpenChange,
  item,
}: {
  catalogType: CatalogTypeView
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: CatalogItem | null
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const form = useForm<ItemValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: toValues(catalogType, item),
  })
  useEffect(() => {
    if (open) form.reset(toValues(catalogType, item))
  }, [open, item, form, catalogType])

  const label = catalogType
  // The type's units, plus the item's own should the type no longer allow it.
  const units: BillingUnit[] = BILLING_UNITS.filter(
    (u) => catalogType.billingUnits.includes(u) || item?.billingUnit === u
  )
  const unitItems = units.map((u) => ({
    value: u,
    label: BILLING_UNIT_LABELS[u],
  }))
  const onSuccess = async (data: object) => {
    toast.success(
      item ? savedMessage(label.singular, data) : `${label.singular} created.`
    )
    await queryClient.invalidateQueries(trpc.catalogItem.pathFilter())
    onOpenChange(false)
  }
  const onError = (e: unknown) => toast.error(errorMessage(e))
  const create = useMutation(
    trpc.catalogItem.create.mutationOptions({ onSuccess, onError })
  )
  const update = useMutation(
    trpc.catalogItem.update.mutationOptions({ onSuccess, onError })
  )
  const pending = create.isPending || update.isPending

  const onSubmit = form.handleSubmit((values) => {
    const input = {
      ...values,
      billingUnit: units.includes(values.billingUnit)
        ? values.billingUnit
        : defaultBillingUnit(catalogType),
      tags: splitTags(values.tags),
    }
    if (item) update.mutate({ id: item.id, ...input })
    else create.mutate({ catalogTypeId: catalogType.id, ...input })
  })

  const text = (
    name: "name" | "price" | "cost" | "tags",
    fieldLabel: string,
    options: { description?: string; inputMode?: "decimal" } = {}
  ) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`item-${name}`}>{fieldLabel}</FieldLabel>
          <Input
            {...field}
            id={`item-${name}`}
            inputMode={options.inputMode}
            aria-invalid={fieldState.invalid}
            autoComplete="off"
          />
          {options.description && (
            <FieldDescription>{options.description}</FieldDescription>
          )}
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
            {item ? `Edit ${label.singular}` : `New ${label.singular}`}
          </DialogTitle>
          <DialogDescription>
            {`${label.plural} are billed ${billingUnitsLabel(catalogType.billingUnits)}.`}{" "}
            Price changes never alter existing Quotes.
          </DialogDescription>
        </DialogHeader>
        <form id="catalog-item-form" onSubmit={onSubmit}>
          <FieldGroup>
            {text("name", "Name")}
            <Controller
              name="description"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="item-description">
                    Description
                  </FieldLabel>
                  <Textarea {...field} id="item-description" rows={3} />
                </Field>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {text("price", "Price", { inputMode: "decimal" })}
              {text("cost", "Cost", { inputMode: "decimal" })}
            </div>
            {units.length > 1 && (
              <Controller
                name="billingUnit"
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="item-billingUnit">
                      Billing unit
                    </FieldLabel>
                    <Select
                      items={unitItems}
                      value={field.value}
                      onValueChange={(v) => v && field.onChange(v)}
                    >
                      <SelectTrigger id="item-billingUnit" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {unitItems.map((u) => (
                          <SelectItem key={u.value} value={u.value}>
                            {u.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />
            )}
            {text("tags", "Tags", {
              description: "Separate tags with commas.",
            })}
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
          <Button type="submit" form="catalog-item-form" disabled={pending}>
            {pending ? "Saving…" : item ? "Save" : `Create ${label.singular}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
