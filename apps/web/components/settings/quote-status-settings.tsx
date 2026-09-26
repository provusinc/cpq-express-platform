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
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { QUOTE_STAGE_LABELS, QUOTE_STAGES } from "@workspace/domain/enums"
import type { QuoteStage } from "@workspace/domain/enums"
import {
  canAddQuoteStatus,
  canDeleteQuoteStatus,
  checkQuoteStatusName,
  QUOTE_STATUS_COLOURS,
  QUOTE_STATUS_NAME_MAX,
} from "@workspace/domain/stages"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"

import { QuoteStatusBadge } from "@/components/quotes/quote-status-badge"
import { errorCode, errorMessage, fieldErrors } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

/** What each fixed Quote Stage does (ADR-0004), one line per block. */
const STAGE_DESCRIPTIONS: Record<QuoteStage, string> = {
  draft: "Editable. The Quote Owner submits it for approval from here.",
  in_approval: "Locked while an Approver approves or rejects it.",
  approved: "Approved and ready to be marked as sent to the customer.",
  with_customer:
    "Sent and awaiting the customer's answer. The Quote Document is captured on entry.",
  won: "Final: the customer said yes. Nothing moves it again.",
  lost: "Final: the deal is dead. Only an Admin can reopen it.",
}

/** The hint on a Stage's first Status, where Quotes entering it land. */
const entryHint = (stage: QuoteStage) =>
  stage === "draft"
    ? "New Quotes start here"
    : `Quotes entering ${QUOTE_STAGE_LABELS[stage]} start here`

/** "No colour" in the colour picker: the Status takes its Stage's tone. */
const STAGE_TONE = "stage"

interface StatusView {
  id: string
  stage: QuoteStage
  name: string
  sequence: number
  colour: string | null
  quoteCount: number
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`

/** Refreshes every place a Status name or order is read. */
function useRefreshStatuses() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.settings.quoteStatuses.pathFilter()),
      queryClient.invalidateQueries(trpc.quoteStatus.pathFilter()),
      queryClient.invalidateQueries(trpc.quote.pathFilter()),
      queryClient.invalidateQueries(trpc.dashboard.pathFilter()),
    ])
    router.refresh()
  }
}

/**
 * Settings → Quote Statuses: the Organization's Statuses inside each fixed
 * Quote Stage (ADR-0004). An Admin adds, renames, recolours, reorders and
 * deletes them; the first of a Stage is its entry Status.
 */
export function QuoteStatusSettings() {
  const trpc = useTRPC()
  const { data: statuses } = useSuspenseQuery(
    trpc.settings.quoteStatuses.queryOptions()
  )
  const [editing, setEditing] = useState<
    | { mode: "create"; stage: QuoteStage }
    | { mode: "edit"; status: StatusView }
    | null
  >(null)
  const [deleting, setDeleting] = useState<StatusView | null>(null)

  return (
    <FieldGroup>
      <FieldDescription>
        Name the steps your team uses inside each Stage. The Stage decides what
        can happen to a Quote; a Status is only its label. Approval history
        keeps the names used at the time.
      </FieldDescription>
      {QUOTE_STAGES.map((stage) => (
        <StageBlock
          key={stage}
          stage={stage}
          statuses={statuses.filter((s) => s.stage === stage)}
          onAdd={() => setEditing({ mode: "create", stage })}
          onEdit={(status) => setEditing({ mode: "edit", status })}
          onDelete={setDeleting}
        />
      ))}
      <QuoteStatusDialog
        target={editing}
        statuses={statuses}
        onClose={() => setEditing(null)}
      />
      <DeleteQuoteStatusDialog
        status={deleting}
        statuses={statuses}
        onClose={() => setDeleting(null)}
      />
    </FieldGroup>
  )
}

function StageBlock({
  stage,
  statuses,
  onAdd,
  onEdit,
  onDelete,
}: {
  stage: QuoteStage
  statuses: StatusView[]
  onAdd: () => void
  onEdit: (status: StatusView) => void
  onDelete: (status: StatusView) => void
}) {
  const trpc = useTRPC()
  const refresh = useRefreshStatuses()
  const reorder = useMutation(
    trpc.settings.reorderQuoteStatuses.mutationOptions()
  )
  const room = canAddQuoteStatus(statuses.length)

  async function move(index: number, by: -1 | 1) {
    const ids = statuses.map((s) => s.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + by, 0, moved!)
    try {
      await reorder.mutateAsync({ stage, ids })
      await refresh()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <FieldSet>
      <FieldLegend>{QUOTE_STAGE_LABELS[stage]}</FieldLegend>
      <FieldDescription>{STAGE_DESCRIPTIONS[stage]}</FieldDescription>
      <ItemGroup className="gap-0 border has-data-[size=sm]:gap-0">
        {statuses.map((status, index) => (
          <Item
            key={status.id}
            size="sm"
            className={cn(index > 0 && "border-t-border")}
          >
            <ItemContent className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
              <ItemTitle>
                <QuoteStatusBadge stage={stage} status={status} />
              </ItemTitle>
              {index === 0 && (
                <Badge variant="outline" className="rounded-md">
                  {entryHint(stage)}
                </Badge>
              )}
              <ItemDescription className="tabular-nums">
                {status.quoteCount === 0
                  ? "No Quotes"
                  : plural(status.quoteCount, "Quote")}
              </ItemDescription>
            </ItemContent>
            <ItemActions className="gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${status.name} up`}
                disabled={index === 0 || reorder.isPending}
                onClick={() => move(index, -1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${status.name} down`}
                disabled={index === statuses.length - 1 || reorder.isPending}
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
                      aria-label={`More actions for ${status.name}`}
                    />
                  }
                >
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => onEdit(status)}>
                    <PencilIcon />
                    Edit…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={statuses.length <= 1}
                    onClick={() => onDelete(status)}
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
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" disabled={!room.ok} onClick={onAdd}>
          <PlusIcon data-icon="inline-start" />
          Add Status
        </Button>
        {!room.ok && (
          <span className="text-sm text-muted-foreground">{room.message}</span>
        )}
        {statuses.length === 1 && (
          <span className="text-sm text-muted-foreground">
            A Stage keeps at least one Status: rename it instead of deleting.
          </span>
        )}
      </div>
    </FieldSet>
  )
}

const formSchema = z.object({
  name: z.string(),
  colour: z.string(),
})

type FormValues = z.infer<typeof formSchema>

/** Adds a Status to a Stage, or renames and recolours one. */
function QuoteStatusDialog({
  target,
  statuses,
  onClose,
}: {
  target:
    | { mode: "create"; stage: QuoteStage }
    | { mode: "edit"; status: StatusView }
    | null
  statuses: StatusView[]
  onClose: () => void
}) {
  const open = target !== null
  const stage = target?.mode === "edit" ? target.status.stage : target?.stage
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        {target && stage && (
          <QuoteStatusForm
            key={target.mode === "edit" ? target.status.id : `new-${stage}`}
            target={target}
            stage={stage}
            statuses={statuses}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function QuoteStatusForm({
  target,
  stage,
  statuses,
  onClose,
}: {
  target:
    | { mode: "create"; stage: QuoteStage }
    | { mode: "edit"; status: StatusView }
  stage: QuoteStage
  statuses: StatusView[]
  onClose: () => void
}) {
  const trpc = useTRPC()
  const refresh = useRefreshStatuses()
  const create = useMutation(trpc.settings.createQuoteStatus.mutationOptions())
  const update = useMutation(trpc.settings.updateQuoteStatus.mutationOptions())
  const editing = target.mode === "edit" ? target.status : null

  // Other Statuses' names, checked with the API's rule.
  const taken = statuses.filter((s) => s.id !== editing?.id).map((s) => s.name)
  const schema = formSchema.superRefine((values, ctx) => {
    const check = checkQuoteStatusName(values.name, taken)
    if (!check.ok) {
      ctx.addIssue({ code: "custom", message: check.message, path: ["name"] })
    }
  })

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: editing?.name ?? "",
      colour: editing?.colour ?? STAGE_TONE,
    },
  })
  const [name, colour] = useWatch({
    control: form.control,
    name: ["name", "colour"],
  })

  async function onSubmit(values: FormValues) {
    const colourValue = values.colour === STAGE_TONE ? null : values.colour
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          name: values.name,
          colour: colourValue,
        })
        toast.success("Quote Status saved")
      } else {
        await create.mutateAsync({
          stage,
          name: values.name,
          colour: colourValue,
        })
        toast.success(`Added to ${QUOTE_STAGE_LABELS[stage]}`)
      }
      await refresh()
      onClose()
    } catch (error) {
      const fields = fieldErrors(error)
      if (fields.name) form.setError("name", { message: fields.name })
      if (fields.colour) form.setError("colour", { message: fields.colour })
      if (errorCode(error) === "CONFLICT") {
        form.setError("name", { message: errorMessage(error) })
      } else if (Object.keys(fields).length === 0) {
        form.setError("root", { message: errorMessage(error) })
      }
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <DialogHeader>
        <DialogTitle>
          {editing ? "Edit Quote Status" : "New Quote Status"}
        </DialogTitle>
        <DialogDescription>
          In the {QUOTE_STAGE_LABELS[stage]} Stage.
          {editing && editing.quoteCount > 0
            ? ` A new name shows on its ${plural(editing.quoteCount, "Quote")} at once.`
            : ""}
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
              <FieldLabel htmlFor="quote-status-name">Name</FieldLabel>
              <Input
                {...field}
                id="quote-status-name"
                placeholder="Legal review"
                maxLength={QUOTE_STATUS_NAME_MAX + 10}
                autoComplete="off"
                autoFocus
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="colour"
          control={form.control}
          render={({ field, fieldState }) => (
            <FieldSet data-invalid={fieldState.invalid}>
              <FieldLegend variant="label">Colour</FieldLegend>
              <ToggleGroup
                multiple={false}
                variant="outline"
                size="sm"
                aria-label="Colour"
                value={[field.value]}
                onValueChange={(values) =>
                  values[0] && field.onChange(values[0])
                }
                className="flex-wrap"
              >
                <ToggleGroupItem value={STAGE_TONE} className="px-2.5">
                  Stage tone
                </ToggleGroupItem>
                {QUOTE_STATUS_COLOURS.map((option) => (
                  <ToggleGroupItem
                    key={option.colour}
                    value={option.colour}
                    aria-label={option.label}
                    title={option.label}
                  >
                    <span
                      aria-hidden
                      className="size-3.5 rounded-full"
                      style={{ backgroundColor: option.colour }}
                    />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription className="flex items-center gap-2">
                Preview
                <QuoteStatusBadge
                  stage={stage}
                  status={{
                    name: name.trim() || "Status",
                    colour: colour === STAGE_TONE ? null : colour,
                  }}
                />
              </FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </FieldSet>
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
              : "Add Status"}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * Deletes a Status. When Quotes sit on it, the Admin picks another Status of
 * the same Stage and those Quotes move there (no Approval Steps).
 */
function DeleteQuoteStatusDialog({
  status,
  statuses,
  onClose,
}: {
  status: StatusView | null
  statuses: StatusView[]
  onClose: () => void
}) {
  return (
    <AlertDialog open={status !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        {status && (
          <DeleteQuoteStatusForm
            key={status.id}
            status={status}
            options={statuses.filter(
              (s) => s.stage === status.stage && s.id !== status.id
            )}
            onClose={onClose}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DeleteQuoteStatusForm({
  status,
  options,
  onClose,
}: {
  status: StatusView
  options: StatusView[]
  onClose: () => void
}) {
  const trpc = useTRPC()
  const refresh = useRefreshStatuses()
  const remove = useMutation(trpc.settings.deleteQuoteStatus.mutationOptions())
  const inUse = status.quoteCount > 0
  const [replacementId, setReplacementId] = useState<string | null>(
    inUse ? (options[0]?.id ?? null) : null
  )
  const replacement = options.find((s) => s.id === replacementId) ?? null
  const allowed = canDeleteQuoteStatus({
    status,
    countInStage: options.length + 1,
    quoteCount: status.quoteCount,
    replacement: inUse ? replacement : null,
  })

  async function onConfirm() {
    try {
      const result = await remove.mutateAsync({
        id: status.id,
        replacementId: inUse ? (replacementId ?? undefined) : undefined,
      })
      toast.success(`Deleted “${status.name}”`, {
        description:
          result.moved > 0 && replacement
            ? `${plural(result.moved, "Quote")} moved to ${replacement.name}.`
            : undefined,
      })
      await refresh()
      onClose()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete “{status.name}”?</AlertDialogTitle>
        <AlertDialogDescription>
          {inUse
            ? `${plural(status.quoteCount, "Quote")} ${status.quoteCount === 1 ? "is" : "are"} in this Status. Pick where to move ${status.quoteCount === 1 ? "it" : "them"}; ${status.quoteCount === 1 ? "its" : "their"} approval history is unchanged.`
            : "No Quotes are in this Status. This can't be undone."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      {inUse && (
        <Field>
          <FieldLabel htmlFor="replacement-status">Move Quotes to</FieldLabel>
          <Select
            items={Object.fromEntries(options.map((s) => [s.id, s.name]))}
            value={replacementId}
            onValueChange={(next) => setReplacementId(next as string | null)}
          >
            <SelectTrigger id="replacement-status" className="w-full">
              <SelectValue placeholder="Pick a Status" />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={remove.isPending}>
          Cancel
        </AlertDialogCancel>
        <Button
          variant="destructive"
          disabled={!allowed.ok || remove.isPending}
          onClick={onConfirm}
        >
          {remove.isPending
            ? "Deleting…"
            : inUse
              ? "Move and delete"
              : "Delete"}
        </Button>
      </AlertDialogFooter>
    </>
  )
}
