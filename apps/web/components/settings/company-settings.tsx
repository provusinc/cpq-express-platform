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

import type { RouterOutputs } from "@workspace/api"
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

import { errorMessage, fieldErrors } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { LogoUpload } from "./logo-upload"

type Company = RouterOutputs["settings"]["company"]

/** Mirrors `settings.updateCompany`'s input; the API re-validates and normalises. */
const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter the company name.")
    .max(200, "Use at most 200 characters."),
  email: z
    .string()
    .trim()
    .pipe(z.union([z.literal(""), z.email("Enter a valid email address.")])),
  phone: z.string().trim().max(40, "Use at most 40 characters."),
  website: z.string().trim().max(200, "Use at most 200 characters."),
  addressLine1: z.string().trim().max(200, "Use at most 200 characters."),
  addressLine2: z.string().trim().max(200, "Use at most 200 characters."),
  city: z.string().trim().max(200, "Use at most 200 characters."),
  region: z.string().trim().max(200, "Use at most 200 characters."),
  postalCode: z.string().trim().max(20, "Use at most 20 characters."),
  country: z.string().trim().max(200, "Use at most 200 characters."),
})

type FormValues = z.infer<typeof formSchema>
type FieldName = keyof FormValues

const toForm = (company: Company): FormValues => ({
  name: company.name,
  email: company.email ?? "",
  phone: company.phone ?? "",
  website: company.website ?? "",
  addressLine1: company.addressLine1 ?? "",
  addressLine2: company.addressLine2 ?? "",
  city: company.city ?? "",
  region: company.region ?? "",
  postalCode: company.postalCode ?? "",
  country: company.country ?? "",
})

/** Settings → Company: company information and the logo, for Quote Documents. */
export function CompanySettings() {
  const trpc = useTRPC()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: company } = useSuspenseQuery(
    trpc.settings.company.queryOptions()
  )
  const update = useMutation(trpc.settings.updateCompany.mutationOptions())

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toForm(company),
  })

  async function onSubmit(values: FormValues) {
    try {
      const saved = await update.mutateAsync(values)
      queryClient.setQueryData(trpc.settings.company.queryKey(), saved)
      form.reset(toForm(saved))
      toast.success("Company information saved")
      // The name shows in the shell (header, Organization switcher).
      if (saved.name !== company.name) router.refresh()
    } catch (error) {
      const fields = fieldErrors(error)
      for (const [name, message] of Object.entries(fields)) {
        if (name in formSchema.shape) {
          form.setError(name as FieldName, { message })
        }
      }
      if (Object.keys(fields).length === 0) {
        form.setError("root", { message: errorMessage(error) })
      }
    }
  }

  const text = (
    name: FieldName,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
    description?: string
  ) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`company-${name}`}>{label}</FieldLabel>
          <Input
            {...field}
            id={`company-${name}`}
            aria-invalid={fieldState.invalid}
            {...props}
          />
          {description && <FieldDescription>{description}</FieldDescription>}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  )

  return (
    <div className="flex flex-col gap-8">
      <LogoUpload logoUrl={company.logoUrl} />
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          {form.formState.errors.root && (
            <Alert variant="destructive">
              <AlertDescription>
                {form.formState.errors.root.message}
              </AlertDescription>
            </Alert>
          )}
          <FieldSet>
            <FieldLegend>Company</FieldLegend>
            <FieldDescription>
              Shown on your Quote Documents. The name is also your
              Organization&apos;s name across CPQ Express.
            </FieldDescription>
            <FieldGroup>
              {text("name", "Company name", { autoComplete: "organization" })}
              <div className="grid gap-6 sm:grid-cols-2">
                {text("email", "Email", {
                  type: "email",
                  autoComplete: "email",
                })}
                {text("phone", "Phone", { type: "tel", autoComplete: "tel" })}
              </div>
              {text(
                "website",
                "Website",
                { placeholder: "acme.com", autoComplete: "url" },
                "We add https:// when it's left out."
              )}
            </FieldGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend>Address</FieldLegend>
            <FieldGroup>
              {text("addressLine1", "Address line 1", {
                autoComplete: "address-line1",
              })}
              {text("addressLine2", "Address line 2", {
                autoComplete: "address-line2",
              })}
              <div className="grid gap-6 sm:grid-cols-2">
                {text("city", "City", { autoComplete: "address-level2" })}
                {text("region", "State / region", {
                  autoComplete: "address-level1",
                })}
                {text("postalCode", "Postal code", {
                  autoComplete: "postal-code",
                })}
                {text("country", "Country", { autoComplete: "country-name" })}
              </div>
            </FieldGroup>
          </FieldSet>
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
    </div>
  )
}
