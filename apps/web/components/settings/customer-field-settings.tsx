"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  EllipsisIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import type { RouterOutputs } from "@workspace/api"
import {
  checkClassificationName,
  CUSTOMER_CLASSIFICATION_NAME_MAX,
} from "@workspace/domain/customers"
import {
  CUSTOMER_CLASSIFICATION_KIND_LABELS,
  CUSTOMER_CLASSIFICATION_KINDS,
} from "@workspace/domain/enums"
import type { CustomerClassificationKind } from "@workspace/domain/enums"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmDialog } from "@/components/shell/confirm-dialog"
import { errorCode, errorMessage, fieldErrors } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

type Value = RouterOutputs["settings"]["customerClassifications"][number]

/** What each list is for, one line under its title. */
const KIND_DESCRIPTIONS: Record<CustomerClassificationKind, string> = {
  customer_type: "Where the Customer stands with you, such as Prospect.",
  industry: "The line of business the Customer is in.",
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

/** Refreshes every place a value's name, order or state is read. */
function useRefreshValues() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries(
        trpc.settings.customerClassifications.pathFilter()
      ),
      queryClient.invalidateQueries(trpc.customer.pathFilter()),
      queryClient.invalidateQueries(trpc.quote.overview.pathFilter()),
    ])
}

/**
 * Settings → Customer fields: the Organization's Customer Types and
 * Industries. An Admin adds, renames, reorders, retires / brings back and
 * deletes unused values; a value in use can only be retired.
 */
export function CustomerFieldSettings() {
  const trpc = useTRPC()
  const { data: values } = useSuspenseQuery(
    trpc.settings.customerClassifications.queryOptions()
  )
  const [editing, setEditing] = useState<
    | { mode: "create"; kind: CustomerClassificationKind }
    | { mode: "edit"; value: Value }
    | null
  >(null)
  const [deleting, setDeleting] = useState<Value | null>(null)

  return (
    <FieldGroup>
      <FieldDescription>
        The values your team picks from on a Customer. Both are optional. A
        value in use can&apos;t be deleted: retire it to stop offering it, and
        the Customers that have it keep it until changed. A new name shows on
        every Customer at once.
      </FieldDescription>
      {CUSTOMER_CLASSIFICATION_KINDS.map((kind) => (
        <ValueList
          key={kind}
          kind={kind}
          values={values.filter((v) => v.kind === kind)}
          onAdd={() => setEditing({ mode: "create", kind })}
          onEdit={(value) => setEditing({ mode: "edit", value })}
          onDelete={setDeleting}
        />
      ))}
      <ValueDialog
        target={editing}
        values={values}
        onClose={() => setEditing(null)}
      />
      <DeleteValueDialog value={deleting} onClose={() => setDeleting(null)} />
    </FieldGroup>
  )
}

function ValueList({
  kind,
  values,
  onAdd,
  onEdit,
  onDelete,
}: {
  kind: CustomerClassificationKind
  values: Value[]
  onAdd: () => void
  onEdit: (value: Value) => void
  onDelete: (value: Value) => void
}) {
  const trpc = useTRPC()
  const refresh = useRefreshValues()
  const reorder = useMutation(
    trpc.settings.reorderCustomerClassifications.mutationOptions()
  )
  const update = useMutation(
    trpc.settings.updateCustomerClassification.mutationOptions()
  )
  const labels = CUSTOMER_CLASSIFICATION_KIND_LABELS[kind]

  async function move(index: number, by: -1 | 1) {
    const ids = values.map((v) => v.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + by, 0, moved!)
    try {
      await reorder.mutateAsync({ kind, ids })
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function setRetired(value: Value, retired: boolean) {
    try {
      await update.mutateAsync({ id: value.id, retired })
      toast.success(
        retired ? `“${value.name}” retired` : `“${value.name}” offered again`
      )
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <FieldSet>
      <FieldLegend>{labels.plural}</FieldLegend>
      <FieldDescription>{KIND_DESCRIPTIONS[kind]}</FieldDescription>
      {values.length > 0 ? (
        <ItemGroup className="gap-0 border has-data-[size=sm]:gap-0">
          {values.map((value, index) => (
            <Item
              key={value.id}
              size="sm"
              className={cn(index > 0 && "border-t-border")}
            >
              <ItemContent className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
                <ItemTitle
                  className={cn(value.retired && "text-muted-foreground")}
                >
                  {value.name}
                </ItemTitle>
                {value.retired && (
                  <Badge variant="outline" className="rounded-md">
                    Retired
                  </Badge>
                )}
                <ItemDescription className="tabular-nums">
                  {value.customerCount === 0
                    ? "No Customers"
                    : plural(value.customerCount, "Customer")}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${value.name} up`}
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${value.name} down`}
                  disabled={index === values.length - 1 || reorder.isPending}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`More actions for ${value.name}`}
                      />
                    }
                  >
                    <EllipsisIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => onEdit(value)}>
                      <PencilIcon />
                      Rename…
                    </DropdownMenuItem>
                    {value.retired ? (
                      <DropdownMenuItem
                        disabled={update.isPending}
                        onClick={() => setRetired(value, false)}
                      >
                        <ArchiveRestoreIcon />
                        Offer again
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        disabled={update.isPending}
                        onClick={() => setRetired(value, true)}
                      >
                        <ArchiveIcon />
                        Retire
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={value.customerCount > 0}
                      title={
                        value.customerCount > 0
                          ? "In use: retire it instead"
                          : undefined
                      }
                      onClick={() => onDelete(value)}
                    >
                      <Trash2Icon />
                      Delete…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <p className="text-sm text-muted-foreground">
          No {labels.plural} yet: Customers can&apos;t be given one.
        </p>
      )}
      <div>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <PlusIcon data-icon="inline-start" />
          Add {labels.singular}
        </Button>
      </div>
    </FieldSet>
  )
}

const formSchema = z.object({ name: z.string() })
type FormValues = z.infer<typeof formSchema>

/** Adds a value to a list, or renames one. */
function ValueDialog({
  target,
  values,
  onClose,
}: {
  target:
    | { mode: "create"; kind: CustomerClassificationKind }
    | { mode: "edit"; value: Value }
    | null
  values: Value[]
  onClose: () => void
}) {
  const kind = target?.mode === "edit" ? target.value.kind : target?.kind
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {target && kind && (
          <ValueForm
            key={target.mode === "edit" ? target.value.id : `new-${kind}`}
            kind={kind}
            editing={target.mode === "edit" ? target.value : null}
            values={values}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ValueForm({
  kind,
  editing,
  values,
  onClose,
}: {
  kind: CustomerClassificationKind
  editing: Value | null
  values: Value[]
  onClose: () => void
}) {
  const trpc = useTRPC()
  const refresh = useRefreshValues()
  const create = useMutation(
    trpc.settings.createCustomerClassification.mutationOptions()
  )
  const update = useMutation(
    trpc.settings.updateCustomerClassification.mutationOptions()
  )
  const labels = CUSTOMER_CLASSIFICATION_KIND_LABELS[kind]

  // The list's other names, checked with the API's rule.
  const taken = values
    .filter((v) => v.kind === kind && v.id !== editing?.id)
    .map((v) => v.name)
  const schema = formSchema.superRefine((input, ctx) => {
    const check = checkClassificationName(kind, input.name, taken)
    if (!check.ok) {
      ctx.addIssue({ code: "custom", message: check.message, path: ["name"] })
    }
  })
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: editing?.name ?? "" },
  })

  async function onSubmit(input: FormValues) {
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, name: input.name })
        toast.success(`${labels.singular} renamed`)
      } else {
        await create.mutateAsync({ kind, name: input.name })
        toast.success(`${labels.singular} added`)
      }
      await refresh()
      onClose()
    } catch (error) {
      const fields = fieldErrors(error)
      if (fields.name) form.setError("name", { message: fields.name })
      else if (errorCode(error) === "CONFLICT") {
        form.setError("name", { message: errorMessage(error) })
      } else form.setError("root", { message: errorMessage(error) })
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <DialogHeader>
        <DialogTitle>
          {editing ? `Rename ${labels.singular}` : `New ${labels.singular}`}
        </DialogTitle>
        <DialogDescription>
          {editing && editing.customerCount > 0
            ? `The new name shows on its ${plural(editing.customerCount, "Customer")} at once.`
            : `Names are unique among your ${labels.plural}.`}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="py-4">
        {form.formState.errors.root && (
          <Alert variant="destructive">
            <AlertDescription>
              {form.formState.errors.root.message}
            </AlertDescription>
          </Alert>
        )}
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="customer-classification-name">
                Name
              </FieldLabel>
              <Input
                {...field}
                id="customer-classification-name"
                maxLength={CUSTOMER_CLASSIFICATION_NAME_MAX + 10}
                autoComplete="off"
                autoFocus
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting
            ? "Saving…"
            : editing
              ? "Save"
              : `Add ${labels.singular}`}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Deletes an unused value; the API refuses one in use (retire it). */
function DeleteValueDialog({
  value,
  onClose,
}: {
  value: Value | null
  onClose: () => void
}) {
  const trpc = useTRPC()
  const refresh = useRefreshValues()
  const remove = useMutation(
    trpc.settings.deleteCustomerClassification.mutationOptions({
      onSuccess: async () => {
        toast.success(`Deleted “${value?.name ?? ""}”`)
        await refresh()
        onClose()
      },
      onError: (error) => {
        toast.error(errorMessage(error))
        onClose()
      },
    })
  )
  return (
    <ConfirmDialog
      open={value !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`Delete “${value?.name ?? ""}”?`}
      description="No Customer has this value. This can't be undone."
      pending={remove.isPending}
      onConfirm={() => value && remove.mutate({ id: value.id })}
    />
  )
}
