"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import {
  checkDocumentSettings,
  DOCUMENT_FORMAT_LABELS,
  DOCUMENT_FORMATS,
  DOCUMENT_SECTION_LABELS,
  DOCUMENT_SECTIONS,
  FOOTER_TEXT_MAX,
  MONEY_DECIMALS_MAX,
  normalizeHexColor,
  QUANTITY_DECIMALS_MAX,
} from "@workspace/domain/documents"
import type {
  DocumentSectionSetting,
  DocumentSettings as Settings,
} from "@workspace/domain/documents"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"

import { errorMessage, fieldErrors } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

/** The form edits decimals as strings ("currency" = the currency's). */
const CURRENCY_DECIMALS = "currency"

const formSchema = z
  .object({
    format: z.enum(DOCUMENT_FORMATS),
    primaryColor: z.string(),
    accentColor: z.string(),
    sections: z.array(
      z.object({ section: z.enum(DOCUMENT_SECTIONS), visible: z.boolean() })
    ),
    moneyDecimals: z.string(),
    quantityDecimals: z.string(),
    locale: z.string(),
    footerText: z.string(),
    terms: z.string(),
  })
  .superRefine((values, ctx) => {
    const check = checkDocumentSettings(toInput(values))
    if (!check.ok) {
      ctx.addIssue({
        code: "custom",
        message: check.message,
        path: [check.field],
      })
    }
  })

type FormValues = z.infer<typeof formSchema>

function toInput(values: FormValues) {
  return {
    ...values,
    moneyDecimals:
      values.moneyDecimals === CURRENCY_DECIMALS
        ? null
        : Number(values.moneyDecimals),
    quantityDecimals: Number(values.quantityDecimals),
  }
}

const toForm = (s: Settings): FormValues => ({
  format: s.format,
  primaryColor: s.primaryColor,
  accentColor: s.accentColor,
  sections: s.sections.map((x) => ({ ...x })),
  moneyDecimals:
    s.moneyDecimals === null ? CURRENCY_DECIMALS : String(s.moneyDecimals),
  quantityDecimals: String(s.quantityDecimals),
  locale: s.locale,
  footerText: s.footerText ?? "",
  terms: s.terms ?? "",
})

const range = (max: number) =>
  Array.from({ length: max + 1 }, (_, i) => String(i))

/**
 * Settings → Documents: how Quote Documents look. The Quote editor's
 * Documents tab previews with these, and every generated Document keeps a
 * copy of the settings it used.
 */
export function DocumentSettings() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { data: settings } = useSuspenseQuery(
    trpc.settings.documents.queryOptions()
  )
  const update = useMutation(trpc.settings.updateDocuments.mutationOptions())
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toForm(settings),
  })

  async function onSubmit(values: FormValues) {
    try {
      const saved = await update.mutateAsync(toInput(values))
      queryClient.setQueryData(trpc.settings.documents.queryKey(), saved)
      // Open previews pick up the new look.
      await queryClient.invalidateQueries({
        queryKey: trpc.quoteDocument.previewSnapshot.pathKey(),
      })
      form.reset(toForm(saved))
      toast.success("Document settings saved")
    } catch (error) {
      const fields = fieldErrors(error)
      for (const [name, message] of Object.entries(fields)) {
        form.setError(name as keyof FormValues, { message })
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
          name="format"
          control={form.control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="document-format">Format</FieldLabel>
              <Select
                items={DOCUMENT_FORMATS.map((f) => ({
                  value: f,
                  label: DOCUMENT_FORMAT_LABELS[f],
                }))}
                value={field.value}
                onValueChange={(v) => v && field.onChange(v)}
              >
                <SelectTrigger id="document-format" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {DOCUMENT_FORMAT_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Standard shows Line Item descriptions and dates; Compact fits
                more on a page.
              </FieldDescription>
            </Field>
          )}
        />

        <div className="grid gap-6 sm:grid-cols-2">
          <ColorField name="primaryColor" label="Primary colour" form={form}>
            Headings, the header rule and table headers.
          </ColorField>
          <ColorField name="accentColor" label="Accent colour" form={form}>
            The Total.
          </ColorField>
        </div>

        <Controller
          name="sections"
          control={form.control}
          render={({ field, fieldState }) => (
            <FieldSet data-invalid={fieldState.invalid}>
              <FieldLegend variant="label">Sections</FieldLegend>
              <FieldDescription>
                The order sections appear in, and which are shown. Empty
                sections (no Milestones, no terms) are always left out.
              </FieldDescription>
              <SectionList value={field.value} onChange={field.onChange} />
              <FieldError errors={[fieldState.error]} />
            </FieldSet>
          )}
        />

        <div className="grid gap-6 sm:grid-cols-3">
          <Controller
            name="moneyDecimals"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="money-decimals">Money decimals</FieldLabel>
                <DecimalsSelect
                  id="money-decimals"
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: CURRENCY_DECIMALS, label: "Currency's" },
                    ...range(MONEY_DECIMALS_MAX).map((v) => ({
                      value: v,
                      label: v,
                    })),
                  ]}
                />
                <FieldDescription>Rounded half-up.</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name="quantityDecimals"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="quantity-decimals">
                  Quantity decimals
                </FieldLabel>
                <DecimalsSelect
                  id="quantity-decimals"
                  value={field.value}
                  onChange={field.onChange}
                  options={range(QUANTITY_DECIMALS_MAX).map((v) => ({
                    value: v,
                    label: v,
                  }))}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name="locale"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="document-locale">Locale</FieldLabel>
                <Input
                  {...field}
                  id="document-locale"
                  autoComplete="off"
                  className="w-32"
                  aria-invalid={fieldState.invalid}
                />
                <FieldDescription>
                  Numbers and dates, e.g. en-GB.
                </FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </div>

        <Controller
          name="footerText"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="footer-text">Footer text</FieldLabel>
              <Input
                {...field}
                id="footer-text"
                maxLength={FOOTER_TEXT_MAX}
                aria-invalid={fieldState.invalid}
              />
              <FieldDescription>
                Printed at the bottom of every page, beside the page number.
              </FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="terms"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="terms">Terms</FieldLabel>
              <Textarea
                {...field}
                id="terms"
                rows={6}
                aria-invalid={fieldState.invalid}
              />
              <FieldError errors={[fieldState.error]} />
            </Field>
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

function ColorField({
  name,
  label,
  form,
  children,
}: {
  name: "primaryColor" | "accentColor"
  label: string
  form: ReturnType<typeof useForm<FormValues>>
  children: React.ReactNode
}) {
  return (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`${label} picker`}
              className="h-8 w-10 cursor-pointer rounded-md border bg-transparent p-0.5"
              value={normalizeHexColor(field.value) ?? "#000000"}
              onChange={(e) => field.onChange(e.target.value)}
            />
            <Input
              {...field}
              id={name}
              className="w-28 font-mono"
              autoComplete="off"
              aria-invalid={fieldState.invalid}
            />
          </div>
          <FieldDescription>{children}</FieldDescription>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  )
}

function DecimalsSelect({
  id,
  value,
  onChange,
  options,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(v) => v != null && onChange(String(v))}
    >
      <SelectTrigger id={id} className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The sections in order, each with move up/down and a visibility switch. */
function SectionList({
  value,
  onChange,
}: {
  value: DocumentSectionSetting[]
  onChange: (value: DocumentSectionSetting[]) => void
}) {
  const move = (index: number, by: -1 | 1) => {
    const next = [...value]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item!)
    onChange(next)
  }
  return (
    <ol className="divide-y rounded-lg border">
      {value.map((s, index) => {
        const label = DOCUMENT_SECTION_LABELS[s.section]
        return (
          <li
            key={s.section}
            className="flex items-center gap-3 px-3 py-2 text-sm"
          >
            <span className="w-5 text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <span
              className={s.visible ? "flex-1" : "flex-1 text-muted-foreground"}
            >
              {label}
              {s.section === "footer" && (
                <span className="text-muted-foreground"> · on every page</span>
              )}
            </span>
            <Switch
              aria-label={`Show ${label}`}
              checked={s.visible}
              onCheckedChange={(visible) =>
                onChange(
                  value.map((x, i) => (i === index ? { ...x, visible } : x))
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${label} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${label} down`}
              disabled={index === value.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDownIcon />
            </Button>
          </li>
        )
      })}
    </ol>
  )
}
