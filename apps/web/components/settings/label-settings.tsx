"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { LABEL_TERMS } from "@workspace/domain/enums"
import type { LabelTerm } from "@workspace/domain/enums"
import {
  checkLabelOverride,
  DEFAULT_LABELS,
  LABEL_MAX_LENGTH,
} from "@workspace/domain/settings"
import type { Labels } from "@workspace/domain/settings"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
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

import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

const termSchema = z.object({
  singular: z.string(),
  plural: z.string(),
})

/** Every term's names, checked with the same rule as `settings.updateLabels`. */
const formSchema = z
  .object(
    Object.fromEntries(LABEL_TERMS.map((term) => [term, termSchema])) as Record<
      LabelTerm,
      typeof termSchema
    >
  )
  .superRefine((values, ctx) => {
    for (const term of LABEL_TERMS) {
      const check = checkLabelOverride({ term, ...values[term] })
      if (!check.ok) {
        ctx.addIssue({
          code: "custom",
          message: check.message,
          path: [term, check.field],
        })
      }
    }
  })

type FormValues = z.infer<typeof formSchema>

const toForm = (labels: Labels): FormValues =>
  Object.fromEntries(
    LABEL_TERMS.map((term) => [term, { ...labels[term] }])
  ) as FormValues

const DESCRIPTIONS: Record<LabelTerm, string> = {
  resource_role: "Kinds of labour you sell by the hour, e.g. “Consultant”.",
  phase: "Groupings of Line Items within a Quote, e.g. “Workstream”.",
}

/**
 * Settings → Labels: Label Overrides. Renames terms across the UI (never
 * their meaning). Catalog Types are named directly, so they have none here.
 */
export function LabelSettings() {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: labels } = useSuspenseQuery(trpc.settings.labels.queryOptions())
  const update = useMutation(trpc.settings.updateLabels.mutationOptions())

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toForm(labels),
  })

  async function onSubmit(values: FormValues) {
    try {
      const saved = await update.mutateAsync({
        overrides: LABEL_TERMS.map((term) => ({ term, ...values[term] })),
      })
      queryClient.setQueryData(trpc.settings.labels.queryKey(), saved)
      form.reset(toForm(saved))
      toast.success("Labels saved")
      // The shell (navigation) and server-rendered pages use the labels.
      router.refresh()
    } catch (error) {
      form.setError("root", { message: errorMessage(error) })
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        {form.formState.errors.root && (
          <Alert variant="destructive">
            <AlertDescription>
              {form.formState.errors.root.message}
            </AlertDescription>
          </Alert>
        )}
        <FieldDescription>
          Use your own words for these terms everywhere in CPQ Express. Leave a
          name blank to use the standard one.
        </FieldDescription>
        {LABEL_TERMS.map((term) => (
          <FieldSet key={term}>
            <FieldLegend>{DEFAULT_LABELS[term].plural}</FieldLegend>
            <FieldDescription>{DESCRIPTIONS[term]}</FieldDescription>
            <div className="grid gap-4 sm:grid-cols-2">
              {(["singular", "plural"] as const).map((name) => (
                <Controller
                  key={name}
                  name={`${term}.${name}`}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={`label-${term}-${name}`}>
                        {name === "singular" ? "Singular" : "Plural"}
                      </FieldLabel>
                      <Input
                        {...field}
                        id={`label-${term}-${name}`}
                        placeholder={DEFAULT_LABELS[term][name]}
                        maxLength={LABEL_MAX_LENGTH + 10}
                        autoComplete="off"
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              ))}
            </div>
          </FieldSet>
        ))}
        <div>
          <Button
            type="submit"
            disabled={form.formState.isSubmitting || !form.formState.isDirty}
          >
            {form.formState.isSubmitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
