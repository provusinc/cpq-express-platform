"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Decimal } from "@workspace/domain/money"
import { QUOTE_STAGE_LABELS, QUOTE_STAGES } from "@workspace/domain/enums"
import type { QuoteStage } from "@workspace/domain/enums"
import {
  checkDeletableStages,
  DELETABLE_STAGE_OPTIONS,
} from "@workspace/domain/policy"
import { checkHoursPerDay } from "@workspace/domain/settings"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
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

import { errorMessage, fieldErrors } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

/** Mirrors `settings.updateQuoting`, with the same domain rules. */
const formSchema = z.object({
  hoursPerDay: z.string().superRefine((value, ctx) => {
    const check = checkHoursPerDay(value)
    if (!check.ok) ctx.addIssue({ code: "custom", message: check.message })
  }),
  deletableStages: z
    .array(z.enum(QUOTE_STAGES))
    .refine(
      (stages) => checkDeletableStages(stages).refused.length === 0,
      "Only Draft and Lost Quotes can be deletable."
    ),
})

type FormValues = z.infer<typeof formSchema>

/** "8.00" → "8", "7.50" → "7.5". */
const displayHours = (value: string) => new Decimal(value).toString()

/** Settings → Quoting: Hours Per Day and which Quote Stages allow deletion. */
export function QuotingSettings() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(
    trpc.settings.quoting.queryOptions()
  )
  const update = useMutation(trpc.settings.updateQuoting.mutationOptions())

  const toForm = (s: typeof settings): FormValues => ({
    hoursPerDay: displayHours(s.hoursPerDay),
    deletableStages: s.deletableStages,
  })
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toForm(settings),
  })

  async function onSubmit(values: FormValues) {
    try {
      const saved = await update.mutateAsync(values)
      queryClient.setQueryData(trpc.settings.quoting.queryKey(), saved)
      form.reset(toForm(saved))
      toast.success("Quoting settings saved")
    } catch (error) {
      const fields = fieldErrors(error)
      for (const [name, message] of Object.entries(fields)) {
        if (name in formSchema.shape) {
          form.setError(name as keyof FormValues, { message })
        }
      }
      if (Object.keys(fields).length === 0) {
        form.setError("root", { message: errorMessage(error) })
      }
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
        <Controller
          name="hoursPerDay"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="hours-per-day">Hours Per Day</FieldLabel>
              <Input
                {...field}
                id="hours-per-day"
                inputMode="decimal"
                className="w-28"
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              <FieldDescription>
                Billable hours in a working day. Hourly rates and Effort convert
                with it: a week is 5 days, a month 20 and a quarter 60.
              </FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="deletableStages"
          control={form.control}
          render={({ field, fieldState }) => (
            <FieldSet data-invalid={fieldState.invalid}>
              <FieldLegend variant="label">Deleting Quotes</FieldLegend>
              <FieldDescription>
                The Quote Owner or an Admin can permanently delete a Quote in
                these Stages. Quotes In Approval, Approved, With Customer or Won
                can never be deleted.
              </FieldDescription>
              <FieldGroup data-slot="checkbox-group" className="gap-3">
                {DELETABLE_STAGE_OPTIONS.map((stage) => (
                  <StageCheckbox
                    key={stage}
                    stage={stage}
                    checked={field.value.includes(stage)}
                    onCheckedChange={(checked) =>
                      field.onChange(
                        checked
                          ? [...field.value, stage]
                          : field.value.filter((s) => s !== stage)
                      )
                    }
                  />
                ))}
              </FieldGroup>
              <FieldError errors={[fieldState.error]} />
            </FieldSet>
          )}
        />
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

function StageCheckbox({
  stage,
  checked,
  onCheckedChange,
}: {
  stage: QuoteStage
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const id = `deletable-${stage}`
  return (
    <Field orientation="horizontal">
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <FieldContent>
        <FieldLabel htmlFor={id} className="font-normal">
          {QUOTE_STAGE_LABELS[stage]} Quotes may be deleted
        </FieldLabel>
      </FieldContent>
    </Field>
  )
}
