"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"
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
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"

import { useLabels } from "@/components/shell/labels"
import { errorMessage, fieldErrors } from "@/lib/trpc-errors"

/** Mirrors `phase.create`'s name rule; the API re-validates. */
const formSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200),
})
type FormValues = z.infer<typeof formSchema>

/**
 * Names a new Phase: top level, or inside `parentName` when adding a
 * sub-Phase. `onCreate` resolves once the Phase exists (the dialog then
 * closes) and rejects with the API error, shown in the form.
 */
export function PhaseDialog({
  open,
  onOpenChange,
  parentName,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The parent Phase's name, or null for a top-level one. */
  parentName: string | null
  onCreate: (name: string) => Promise<unknown>
}) {
  const labels = useLabels()
  const { singular } = labels.phase
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "" },
  })

  function change(next: boolean) {
    if (!next) form.reset({ name: "" })
    onOpenChange(next)
  }

  async function onSubmit(values: FormValues) {
    try {
      await onCreate(values.name)
      change(false)
    } catch (error) {
      const message = fieldErrors(error).name
      if (message) form.setError("name", { message })
      else form.setError("root", { message: errorMessage(error) })
    }
  }

  const title = parentName
    ? `New sub-${singular.toLowerCase()}`
    : `New ${singular.toLowerCase()}`

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {parentName
                ? `Inside “${parentName}”.`
                : `A top-level ${singular.toLowerCase()} of this Quote.`}
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
                  <FieldLabel htmlFor="phase-name">Name</FieldLabel>
                  <Input
                    {...field}
                    id="phase-name"
                    autoFocus
                    autoComplete="off"
                    maxLength={200}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => change(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? "Adding…"
                : `Add ${singular.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
