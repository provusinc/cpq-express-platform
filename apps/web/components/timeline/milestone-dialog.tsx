"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"

import { isIsoDate } from "@workspace/domain/dates"
import { MILESTONE_TYPE_LABELS, MILESTONE_TYPES } from "@workspace/domain/enums"
import type { MilestoneType } from "@workspace/domain/enums"
import {
  checkMilestoneColour,
  DEFAULT_MILESTONE_COLOURS,
  MILESTONE_DESCRIPTION_MAX,
  MILESTONE_NAME_MAX,
} from "@workspace/domain/milestones"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
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

import type { EditorMilestone } from "@/components/quotes/autosave"
import { errorMessage, fieldErrors } from "@/lib/trpc-errors"

/** Mirrors `milestone.create` / `update`; the API re-validates. */
const formSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(MILESTONE_NAME_MAX),
  date: z.string().refine(isIsoDate, "Pick a date."),
  type: z.enum(MILESTONE_TYPES),
  colour: z
    .string()
    .refine(
      (v) => checkMilestoneColour(v).ok,
      "Use a hex colour such as #2563eb."
    ),
  completed: z.boolean(),
  description: z.string().trim().max(MILESTONE_DESCRIPTION_MAX),
})
export type MilestoneFormValues = z.infer<typeof formSchema>

const TYPE_ITEMS = MILESTONE_TYPES.map((type) => ({
  value: type,
  label: MILESTONE_TYPE_LABELS[type],
}))

function defaultsFor(
  milestone: EditorMilestone | null,
  date: string
): MilestoneFormValues {
  return milestone
    ? {
        name: milestone.name,
        date: milestone.date,
        type: milestone.type,
        colour: milestone.colour,
        completed: milestone.completed,
        description: milestone.description ?? "",
      }
    : {
        name: "",
        date,
        type: "milestone",
        colour: DEFAULT_MILESTONE_COLOURS.milestone,
        completed: false,
        description: "",
      }
}

/**
 * Adds a Milestone (`milestone` null) or edits one. `onSave` gets the
 * values (for an edit, only the changed ones) and resolves once saved; a
 * rejection shows the API's message in the form. A new Milestone's colour
 * follows its type until the colour is picked by hand. Mount it with a
 * `key` per Milestone so the form starts from its values.
 */
export function MilestoneDialog({
  open,
  onOpenChange,
  milestone,
  defaultDate,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  milestone: EditorMilestone | null
  /** Where a new Milestone starts (e.g. the Quote's start date). */
  defaultDate: string
  onSave: (values: Partial<MilestoneFormValues>) => Promise<unknown>
}) {
  const form = useForm<MilestoneFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultsFor(milestone, defaultDate),
  })

  async function onSubmit(values: MilestoneFormValues) {
    const dirty = form.formState.dirtyFields
    const changes: Partial<MilestoneFormValues> = milestone
      ? Object.fromEntries(
          Object.entries(values).filter(
            ([key]) => dirty[key as keyof MilestoneFormValues]
          )
        )
      : values
    if (milestone && Object.keys(changes).length === 0) {
      onOpenChange(false)
      return
    }
    try {
      await onSave(changes)
      onOpenChange(false)
    } catch (error) {
      const fields = fieldErrors(error)
      let mapped = false
      for (const [name, message] of Object.entries(fields)) {
        if (name in values) {
          form.setError(name as keyof MilestoneFormValues, { message })
          mapped = true
        }
      }
      if (!mapped) form.setError("root", { message: errorMessage(error) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <DialogHeader>
            <DialogTitle>
              {milestone ? "Edit Milestone" : "New Milestone"}
            </DialogTitle>
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
                  <FieldLabel htmlFor="milestone-name">Name</FieldLabel>
                  <Input
                    {...field}
                    id="milestone-name"
                    autoFocus
                    autoComplete="off"
                    maxLength={MILESTONE_NAME_MAX}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <Controller
                name="date"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="milestone-date">Date</FieldLabel>
                    <Input
                      {...field}
                      id="milestone-date"
                      type="date"
                      aria-invalid={fieldState.invalid}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                name="type"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="milestone-type">Type</FieldLabel>
                    <Select
                      items={TYPE_ITEMS}
                      value={field.value}
                      onValueChange={(next) => {
                        if (!next) return
                        const type = next as MilestoneType
                        field.onChange(type)
                        // A new Milestone's colour follows its type until picked.
                        if (
                          !milestone &&
                          !form.getFieldState("colour").isDirty
                        ) {
                          form.setValue(
                            "colour",
                            DEFAULT_MILESTONE_COLOURS[type]
                          )
                        }
                      }}
                    >
                      <SelectTrigger id="milestone-type" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TYPE_ITEMS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </div>
            <Controller
              name="colour"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="milestone-colour">Colour</FieldLabel>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Pick a colour"
                      className="h-9 w-12 cursor-pointer rounded-md border bg-background p-1"
                      value={
                        checkMilestoneColour(field.value).ok
                          ? field.value
                          : "#000000"
                      }
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                    <Input
                      {...field}
                      id="milestone-colour"
                      className="w-32 font-mono"
                      aria-invalid={fieldState.invalid}
                    />
                  </div>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              name="description"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="milestone-description">
                    Description
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="milestone-description"
                    rows={3}
                    maxLength={MILESTONE_DESCRIPTION_MAX}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              name="completed"
              control={form.control}
              render={({ field }) => (
                <Field orientation="horizontal">
                  <Checkbox
                    id="milestone-completed"
                    checked={field.value}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true)
                    }
                  />
                  <FieldLabel htmlFor="milestone-completed">
                    Completed
                  </FieldLabel>
                </Field>
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? "Saving…"
                : milestone
                  ? "Save"
                  : "Add Milestone"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
