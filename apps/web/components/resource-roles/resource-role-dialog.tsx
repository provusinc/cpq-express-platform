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
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"

import { useLabels } from "@/components/shell/labels"
import { isMoneyInput, trimMoney } from "@/lib/money"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"
import { savedMessage } from "@/components/catalog/cost-propagation"

type ResourceRole = RouterOutputs["resourceRole"]["byId"]

const rate = z
  .string()
  .trim()
  .refine(isMoneyInput, "Enter an hourly rate of 0 or more, up to 4 decimals.")

const roleSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200),
  description: z.string().max(2000),
  billRate: rate,
  costRate: rate,
  locationCountry: z.string().max(100),
  locationState: z.string().max(100),
  locationCity: z.string().max(100),
})
type RoleValues = z.infer<typeof roleSchema>
type TextName = Exclude<keyof RoleValues, "description">

function toValues(role?: ResourceRole | null): RoleValues {
  return {
    name: role?.name ?? "",
    description: role?.description ?? "",
    billRate: role ? trimMoney(role.billRate) : "",
    costRate: role ? trimMoney(role.costRate) : "",
    locationCountry: role?.locationCountry ?? "",
    locationState: role?.locationState ?? "",
    locationCity: role?.locationCity ?? "",
  }
}

/** Create or edit a Resource Role (Admins only; the API re-checks). */
export function ResourceRoleDialog({
  open,
  onOpenChange,
  role,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  role?: ResourceRole | null
}) {
  const trpc = useTRPC()
  const label = useLabels().resource_role
  const queryClient = useQueryClient()
  const form = useForm<RoleValues>({
    resolver: zodResolver(roleSchema),
    defaultValues: toValues(role),
  })
  useEffect(() => {
    if (open) form.reset(toValues(role))
  }, [open, role, form])

  const onSuccess = async (data: object) => {
    toast.success(
      role ? savedMessage(label.singular, data) : `${label.singular} created.`
    )
    await queryClient.invalidateQueries(trpc.resourceRole.pathFilter())
    onOpenChange(false)
  }
  const onError = (e: unknown) => toast.error(errorMessage(e))
  const create = useMutation(
    trpc.resourceRole.create.mutationOptions({ onSuccess, onError })
  )
  const update = useMutation(
    trpc.resourceRole.update.mutationOptions({ onSuccess, onError })
  )
  const pending = create.isPending || update.isPending

  const onSubmit = form.handleSubmit((values) => {
    if (role) update.mutate({ id: role.id, ...values })
    else create.mutate(values)
  })

  const text = (name: TextName, label: string, inputMode?: "decimal") => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`role-${name}`}>{label}</FieldLabel>
          <Input
            {...field}
            id={`role-${name}`}
            inputMode={inputMode}
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
            {role ? `Edit ${label.singular}` : `New ${label.singular}`}
          </DialogTitle>
          <DialogDescription>
            {label.plural} are always billed by the Hour.
          </DialogDescription>
        </DialogHeader>
        <form id="resource-role-form" onSubmit={onSubmit}>
          <FieldGroup>
            {text("name", "Name")}
            <Controller
              name="description"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="role-description">
                    Description
                  </FieldLabel>
                  <Textarea {...field} id="role-description" rows={3} />
                </Field>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {text("billRate", "Bill rate (per hour)", "decimal")}
              {text("costRate", "Cost rate (per hour)", "decimal")}
            </div>
            <FieldSet>
              <FieldLegend variant="label">Location</FieldLegend>
              <div className="grid gap-4 sm:grid-cols-3">
                {text("locationCountry", "Country")}
                {text("locationState", "State / region")}
                {text("locationCity", "City")}
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
          <Button type="submit" form="resource-role-form" disabled={pending}>
            {pending ? "Saving…" : role ? "Save" : `Create ${label.singular}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
