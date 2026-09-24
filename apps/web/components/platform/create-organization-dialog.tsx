"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import {
  checkSlug,
  isCurrencyCode,
  suggestSlug,
} from "@workspace/domain/organizations"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"

import { errorCode, errorMessage, fieldErrors } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

/** Mirrors `platform.createOrganization`'s input; the API re-validates. */
const formSchema = z.object({
  name: z.string().trim().min(1, "Enter a name."),
  slug: z
    .string()
    .trim()
    .superRefine((slug, ctx) => {
      const check = checkSlug(slug)
      if (!check.ok) ctx.addIssue({ code: "custom", message: check.message })
    }),
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isCurrencyCode, "Use a three-letter ISO 4217 code, e.g. USD."),
  adminEmail: z
    .string()
    .trim()
    .pipe(z.union([z.literal(""), z.email("Enter a valid email address.")])),
})

type FormInput = z.input<typeof formSchema>
type FormOutput = z.output<typeof formSchema>

const DEFAULTS: FormInput = {
  name: "",
  slug: "",
  currencyCode: "USD",
  adminEmail: "",
}

export function CreateOrganizationDialog({
  originOf,
  rootDomain,
}: {
  /** Public origin of an Organization's subdomain, for the slug preview. */
  originOf: (slug: string) => string
  rootDomain: string
}) {
  const [open, setOpen] = useState(false)
  // The slug follows the name until the Platform Admin edits it.
  const [slugEdited, setSlugEdited] = useState(false)
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const create = useMutation(trpc.platform.createOrganization.mutationOptions())

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULTS,
  })
  const slug = useWatch({ control: form.control, name: "slug" })

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      form.reset(DEFAULTS)
      setSlugEdited(false)
      create.reset()
    }
  }

  async function onSubmit(values: FormOutput) {
    try {
      const { organization, invitation } = await create.mutateAsync({
        name: values.name,
        slug: values.slug,
        currencyCode: values.currencyCode,
        adminEmail: values.adminEmail || undefined,
      })
      await queryClient.invalidateQueries({
        queryKey: trpc.platform.listOrganizations.queryKey(),
      })
      toast.success(`${organization.name} is ready`, {
        description: invitation
          ? `We emailed an Invitation to ${invitation.email}.`
          : `It's at ${new URL(originOf(organization.slug)).host}.`,
      })
      onOpenChange(false)
    } catch (error) {
      const fields = fieldErrors(error)
      for (const [name, message] of Object.entries(fields)) {
        if (name in DEFAULTS) {
          form.setError(name as keyof FormInput, { message })
        }
      }
      if (errorCode(error) === "CONFLICT") {
        form.setError("slug", { message: errorMessage(error) })
      } else if (Object.keys(fields).length === 0) {
        form.setError("root", { message: errorMessage(error) })
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button />}>
        <PlusIcon />
        New Organization
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <DialogHeader>
            <DialogTitle>New Organization</DialogTitle>
            <DialogDescription>
              The slug is the Organization&apos;s subdomain and can never be
              changed.
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
                  <FieldLabel htmlFor="organization-name">Name</FieldLabel>
                  <Input
                    {...field}
                    id="organization-name"
                    placeholder="Acme Corporation"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                    onChange={(event) => {
                      field.onChange(event)
                      if (!slugEdited) {
                        form.setValue("slug", suggestSlug(event.target.value))
                      }
                    }}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              name="slug"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="organization-slug">Slug</FieldLabel>
                  <Input
                    {...field}
                    id="organization-slug"
                    placeholder="acme"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={fieldState.invalid}
                    onChange={(event) => {
                      setSlugEdited(true)
                      field.onChange(event.target.value.toLowerCase())
                    }}
                  />
                  <FieldDescription>
                    {`${slug || "your-slug"}.${rootDomain}`}
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              name="currencyCode"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="organization-currency">
                    Currency
                  </FieldLabel>
                  <Input
                    {...field}
                    id="organization-currency"
                    className="w-24 uppercase"
                    maxLength={3}
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    Every Quote in the Organization uses it.
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              name="adminEmail"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="organization-admin-email">
                    First Admin&apos;s email (optional)
                  </FieldLabel>
                  <Input
                    {...field}
                    id="organization-admin-email"
                    type="email"
                    placeholder="admin@acme.com"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    We&apos;ll email them an Invitation to join as Admin.
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? "Creating…"
                : "Create Organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
