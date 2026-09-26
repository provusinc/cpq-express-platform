"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EllipsisIcon,
  EyeIcon,
  EyeOffIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import {
  billingUnitsLabel,
  CATALOG_TYPE_COLOUR_COUNT,
  CATALOG_TYPE_NAME_MAX,
  checkBillingUnitRemoval,
  checkCatalogType,
  freeCatalogTypeColours,
  MAX_ACTIVE_CATALOG_TYPES,
} from "@workspace/domain/catalog"
import { BILLING_UNITS } from "@workspace/domain/enums"
import type { BillingUnit } from "@workspace/domain/enums"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Field,
  FieldContent,
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
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Switch } from "@workspace/ui/components/switch"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"

import { ActiveBadge } from "@/components/shell/active-badge"
import type { CatalogTypeView } from "@/components/shell/catalog-types"
import { useLabels } from "@/components/shell/labels"
import { catalogTypeTone, LABOUR_TONE } from "@/components/shell/tints"
import { errorCode, errorMessage, inUseOf } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

const UNIT_LABELS: Record<BillingUnit, string> = { each: "Each", hour: "Hour" }

const COLOUR_INDEXES = Array.from(
  { length: CATALOG_TYPE_COLOUR_COUNT },
  (_, i) => i
)

const itemCount = (n: number, type: CatalogTypeView) =>
  `${n} ${n === 1 ? type.singular : type.plural}`

/** Refreshes every place a Catalog Type's name, colour or order is read. */
function useRefreshCatalogTypes() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.catalogType.pathFilter()),
      queryClient.invalidateQueries(trpc.catalogItem.pathFilter()),
    ])
    // The shell (nav, ⌘K, Add Items tabs) reads them on the server.
    router.refresh()
  }
}

/**
 * Settings → Catalog types (glossary: Catalog Type, ADR-0005): an Admin
 * adds, renames, recolours, reorders, (de)activates and deletes the
 * Organization's Catalog Types. The rules are the domain's, as in the API.
 */
export function CatalogTypeSettings() {
  const trpc = useTRPC()
  const labels = useLabels()
  const { data: types } = useSuspenseQuery(trpc.catalogType.list.queryOptions())
  const [editing, setEditing] = useState<
    { mode: "create" } | { mode: "edit"; type: CatalogTypeView } | null
  >(null)
  const [deleting, setDeleting] = useState<CatalogTypeView | null>(null)
  const activeCount = types.filter((t) => t.active).length

  return (
    <FieldGroup>
      <FieldDescription>
        The kinds of things you sell besides {labels.resource_role.plural}. Each
        type has its own page in the sidebar and its own tab when adding items
        to a Quote, and keeps its colour in charts. At most{" "}
        {MAX_ACTIVE_CATALOG_TYPES} can be active at once.
      </FieldDescription>
      <FieldSet>
        <FieldLegend>Catalog types</FieldLegend>
        <FieldDescription>
          In the order of the sidebar and the Add Items sheet.{" "}
          <span className="tabular-nums">
            {activeCount} of {MAX_ACTIVE_CATALOG_TYPES} active.
          </span>
        </FieldDescription>
        {types.length > 0 && (
          <ItemGroup className="gap-0 border has-data-[size=sm]:gap-0">
            {types.map((type, index) => (
              <CatalogTypeRow
                key={type.id}
                type={type}
                index={index}
                types={types}
                onEdit={() => setEditing({ mode: "edit", type })}
                onDelete={() => setDeleting(type)}
              />
            ))}
          </ItemGroup>
        )}
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing({ mode: "create" })}
          >
            <PlusIcon data-icon="inline-start" />
            Add Catalog Type
          </Button>
        </div>
      </FieldSet>
      <CatalogTypeDialog
        target={editing}
        types={types}
        onClose={() => setEditing(null)}
      />
      <DeleteCatalogTypeDialog
        type={deleting}
        onClose={() => setDeleting(null)}
      />
    </FieldGroup>
  )
}

function CatalogTypeRow({
  type,
  index,
  types,
  onEdit,
  onDelete,
}: {
  type: CatalogTypeView
  index: number
  types: readonly CatalogTypeView[]
  onEdit: () => void
  onDelete: () => void
}) {
  const trpc = useTRPC()
  const refresh = useRefreshCatalogTypes()
  const reorder = useMutation(trpc.catalogType.reorder.mutationOptions())
  const update = useMutation(trpc.catalogType.update.mutationOptions())
  const others = types.filter((t) => t.id !== type.id)

  async function move(by: -1 | 1) {
    const ids = types.map((t) => t.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + by, 0, moved!)
    try {
      await reorder.mutateAsync({ ids })
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  /**
   * Activates (on its colour, or the first free one when an active type
   * took it meanwhile) or deactivates the type.
   */
  async function setActive(active: boolean) {
    const colourIndex =
      active && !free.includes(type.colourIndex) ? free[0] : undefined
    try {
      await update.mutateAsync({ id: type.id, active, colourIndex })
      toast.success(
        active ? `${type.plural} activated` : `${type.plural} deactivated`,
        {
          description: active
            ? undefined
            : "Existing Quotes keep their items; they can't be added any more.",
        }
      )
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const free = freeCatalogTypeColours(others)
  const canActivate = checkCatalogType(
    {
      ...type,
      active: true,
      colourIndex: free.includes(type.colourIndex)
        ? type.colourIndex
        : (free[0] ?? type.colourIndex),
    },
    others
  )

  return (
    <Item size="sm" className={cn(index > 0 && "border-t-border")}>
      <ItemMedia>
        <span
          aria-hidden
          className={cn(
            "size-3 rounded-full",
            catalogTypeTone(type.colourIndex).dot,
            !type.active && "opacity-40"
          )}
        />
      </ItemMedia>
      <ItemContent className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
        <ItemTitle className={cn(!type.active && "text-muted-foreground")}>
          {type.plural}
          <span className="font-normal text-muted-foreground">
            {" "}
            · {type.singular}
          </span>
        </ItemTitle>
        {!type.active && <ActiveBadge active={false} />}
        <ItemDescription className="tabular-nums">
          {billingUnitsLabel(type.billingUnits)} ·{" "}
          {type.itemCount === 0 ? "No items" : itemCount(type.itemCount, type)}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${type.plural} up`}
          disabled={index === 0 || reorder.isPending}
          onClick={() => move(-1)}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${type.plural} down`}
          disabled={index === types.length - 1 || reorder.isPending}
          onClick={() => move(1)}
        >
          <ArrowDownIcon />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`More actions for ${type.plural}`}
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onEdit}>
              <PencilIcon />
              Edit…
            </DropdownMenuItem>
            {type.active ? (
              <DropdownMenuItem
                disabled={update.isPending}
                onClick={() => setActive(false)}
              >
                <EyeOffIcon />
                Deactivate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={!canActivate.ok || update.isPending}
                title={canActivate.ok ? undefined : canActivate.message}
                onClick={() => setActive(true)}
              >
                <EyeIcon />
                Activate
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  )
}

const formSchema = z.object({
  singular: z.string(),
  plural: z.string(),
  billingUnits: z.array(z.enum(BILLING_UNITS)),
  colourIndex: z.number(),
  active: z.boolean(),
})

type FormValues = z.infer<typeof formSchema>

type DialogTarget = { mode: "create" } | { mode: "edit"; type: CatalogTypeView }

/** Adds a Catalog Type, or edits one. */
function CatalogTypeDialog({
  target,
  types,
  onClose,
}: {
  target: DialogTarget | null
  types: readonly CatalogTypeView[]
  onClose: () => void
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        {target && (
          <CatalogTypeForm
            key={target.mode === "edit" ? target.type.id : "new"}
            target={target}
            types={types}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CatalogTypeForm({
  target,
  types,
  onClose,
}: {
  target: DialogTarget
  types: readonly CatalogTypeView[]
  onClose: () => void
}) {
  const trpc = useTRPC()
  const labels = useLabels()
  const refresh = useRefreshCatalogTypes()
  const create = useMutation(trpc.catalogType.create.mutationOptions())
  const update = useMutation(trpc.catalogType.update.mutationOptions())
  const editing = target.mode === "edit" ? target.type : null
  const others = types.filter((t) => t.id !== editing?.id)
  const free = freeCatalogTypeColours(others)
  const roomToActivate =
    others.filter((t) => t.active).length < MAX_ACTIVE_CATALOG_TYPES

  // The API's rules, run on the whole draft.
  const schema = formSchema.superRefine((values, ctx) => {
    const check = checkCatalogType(values, others)
    if (!check.ok) {
      for (const issue of check.issues) {
        ctx.addIssue({
          code: "custom",
          message: issue.message,
          path: [issue.field],
        })
      }
    } else if (editing) {
      const removal = checkBillingUnitRemoval({
        type: check.type,
        from: editing.billingUnits,
        to: check.type.billingUnits,
        itemsByUnit: editing.itemsByUnit,
      })
      if (!removal.ok) {
        ctx.addIssue({
          code: "custom",
          message: removal.message,
          path: ["billingUnits"],
        })
      }
    }
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: editing
      ? {
          singular: editing.singular,
          plural: editing.plural,
          billingUnits: [...editing.billingUnits],
          colourIndex: editing.colourIndex,
          active: editing.active,
        }
      : {
          singular: "",
          plural: "",
          billingUnits: ["each"],
          colourIndex: free[0] ?? 0,
          active: roomToActivate,
        },
  })
  const [active, plural] = useWatch({
    control: form.control,
    name: ["active", "plural"],
  })

  async function onSubmit(values: FormValues) {
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...values })
        toast.success(`${values.plural.trim()} saved`)
      } else {
        await create.mutateAsync(values)
        toast.success(`${values.plural.trim()} added`)
      }
      await refresh()
      onClose()
    } catch (error) {
      const message = errorMessage(error)
      if (errorCode(error) === "CONFLICT" && message.includes("named")) {
        form.setError("singular", { message })
      } else {
        form.setError("root", { message })
      }
    }
  }

  const holderOf = (index: number) =>
    others.find((t) => t.active && t.colourIndex === index)

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <DialogHeader>
        <DialogTitle>
          {editing ? `Edit ${editing.plural}` : "New Catalog Type"}
        </DialogTitle>
        <DialogDescription>
          {editing && editing.itemCount > 0
            ? `New names show at once for its ${itemCount(editing.itemCount, editing)}, and on Quotes that use them.`
            : "A kind of Catalog Item, with its own page and colour."}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="singular"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="catalog-type-singular">
                  Singular name
                </FieldLabel>
                <Input
                  {...field}
                  id="catalog-type-singular"
                  placeholder="Service"
                  maxLength={CATALOG_TYPE_NAME_MAX + 10}
                  autoComplete="off"
                  autoFocus
                  aria-invalid={fieldState.invalid}
                  onBlur={() => {
                    field.onBlur()
                    // Suggest a plural once, when it's still empty.
                    const singular = field.value.trim()
                    if (singular && !plural.trim()) {
                      form.setValue("plural", `${singular}s`)
                    }
                  }}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name="plural"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="catalog-type-plural">
                  Plural name
                </FieldLabel>
                <Input
                  {...field}
                  id="catalog-type-plural"
                  placeholder="Services"
                  maxLength={CATALOG_TYPE_NAME_MAX + 10}
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </div>
        <Controller
          name="billingUnits"
          control={form.control}
          render={({ field, fieldState }) => (
            <FieldSet data-invalid={fieldState.invalid}>
              <FieldLegend variant="label">Billing Units</FieldLegend>
              <FieldDescription>
                How its items may be priced. A flat fee is Each.
              </FieldDescription>
              <div className="flex flex-wrap gap-6">
                {BILLING_UNITS.map((unit) => {
                  const id = `catalog-type-unit-${unit}`
                  const used = editing?.itemsByUnit[unit] ?? 0
                  return (
                    <Field
                      key={unit}
                      orientation="horizontal"
                      className="w-auto"
                    >
                      <Checkbox
                        id={id}
                        checked={field.value.includes(unit)}
                        onCheckedChange={(on) =>
                          field.onChange(
                            on === true
                              ? [...field.value, unit]
                              : field.value.filter((u) => u !== unit)
                          )
                        }
                      />
                      <FieldContent>
                        <FieldLabel htmlFor={id} className="font-normal">
                          {UNIT_LABELS[unit]}
                          {used > 0 && editing && (
                            <span className="text-muted-foreground tabular-nums">
                              · {itemCount(used, editing)}
                            </span>
                          )}
                        </FieldLabel>
                      </FieldContent>
                    </Field>
                  )
                })}
              </div>
              <FieldError errors={[fieldState.error]} />
            </FieldSet>
          )}
        />
        <Controller
          name="colourIndex"
          control={form.control}
          render={({ field, fieldState }) => (
            <FieldSet data-invalid={fieldState.invalid}>
              <FieldLegend variant="label">Colour</FieldLegend>
              <ToggleGroup
                multiple={false}
                variant="outline"
                size="sm"
                aria-label="Colour"
                value={[String(field.value)]}
                onValueChange={(values) =>
                  values[0] !== undefined && field.onChange(Number(values[0]))
                }
                className="flex-wrap"
              >
                <ToggleGroupItem
                  value="labour"
                  disabled
                  aria-label={`${labels.resource_role.plural} (always this colour)`}
                  title={`${labels.resource_role.plural} (always this colour)`}
                >
                  <span
                    aria-hidden
                    className={cn("size-3.5 rounded-full", LABOUR_TONE.dot)}
                  />
                </ToggleGroupItem>
                {COLOUR_INDEXES.map((index) => {
                  const holder = active ? holderOf(index) : undefined
                  const label = holder
                    ? `Colour ${index + 1}, used by ${holder.plural}`
                    : `Colour ${index + 1}`
                  return (
                    <ToggleGroupItem
                      key={index}
                      value={String(index)}
                      disabled={holder !== undefined}
                      aria-label={label}
                      title={label}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-3.5 rounded-full",
                          catalogTypeTone(index).dot,
                          holder && "opacity-30"
                        )}
                      />
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
              <FieldDescription>
                Active types each keep their own colour next to{" "}
                {labels.resource_role.plural}.
              </FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </FieldSet>
          )}
        />
        <Controller
          name="active"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field orientation="horizontal" data-invalid={fieldState.invalid}>
              <FieldContent>
                <FieldLabel htmlFor="catalog-type-active">Active</FieldLabel>
                <FieldDescription>
                  {field.value
                    ? "In the sidebar, ⌘K and the Add Items sheet."
                    : "Hidden from the sidebar and the Add Items sheet. Its items stay on existing Quotes, and its page is read-only."}
                </FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </FieldContent>
              <Switch
                id="catalog-type-active"
                checked={field.value}
                onCheckedChange={(on) => {
                  field.onChange(on)
                  // Move off a colour an active type holds.
                  const current = form.getValues("colourIndex")
                  if (on && holderOf(current) && free[0] !== undefined) {
                    form.setValue("colourIndex", free[0])
                  }
                }}
              />
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
              : "Add Catalog Type"}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * Deletes an unused Catalog Type. One with Catalog Items can only be
 * deactivated: the dialog offers that instead (the API refuses the delete
 * with an "in use" error either way).
 */
function DeleteCatalogTypeDialog({
  type,
  onClose,
}: {
  type: CatalogTypeView | null
  onClose: () => void
}) {
  return (
    <AlertDialog open={type !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        {type && (
          <DeleteCatalogTypeForm key={type.id} type={type} onClose={onClose} />
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DeleteCatalogTypeForm({
  type,
  onClose,
}: {
  type: CatalogTypeView
  onClose: () => void
}) {
  const trpc = useTRPC()
  const refresh = useRefreshCatalogTypes()
  const remove = useMutation(trpc.catalogType.delete.mutationOptions())
  const update = useMutation(trpc.catalogType.update.mutationOptions())
  const [blocked, setBlocked] = useState<string | null>(
    type.itemCount > 0
      ? `This type has ${itemCount(type.itemCount, type)}, so it can't be deleted.`
      : null
  )
  const pending = remove.isPending || update.isPending

  async function onDelete() {
    try {
      await remove.mutateAsync({ id: type.id })
      toast.success(`Deleted ${type.plural}`)
      await refresh()
      onClose()
    } catch (error) {
      if (inUseOf(error)) setBlocked(errorMessage(error))
      else toast.error(errorMessage(error))
    }
  }

  async function onDeactivate() {
    try {
      await update.mutateAsync({ id: type.id, active: false })
      toast.success(`${type.plural} deactivated`)
      await refresh()
      onClose()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {type.plural}?</AlertDialogTitle>
        <AlertDialogDescription>
          {blocked
            ? `${blocked} ${type.active ? "Deactivate it instead: its items stay on existing Quotes but can't be added any more." : "It is already inactive."}`
            : "It has no Catalog Items. This can't be undone."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
        {blocked ? (
          type.active && (
            <Button disabled={pending} onClick={onDeactivate}>
              {update.isPending ? "Deactivating…" : "Deactivate"}
            </Button>
          )
        ) : (
          <Button variant="destructive" disabled={pending} onClick={onDelete}>
            {remove.isPending ? "Deleting…" : "Delete"}
          </Button>
        )}
      </AlertDialogFooter>
    </>
  )
}
