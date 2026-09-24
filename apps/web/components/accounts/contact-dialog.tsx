"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import type { RouterOutputs } from "@workspace/api"
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

import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

type Contact = RouterOutputs["account"]["byId"]["contacts"][number]

const contactSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200),
  title: z.string().max(200),
  email: z.union([z.literal(""), z.email("Enter a valid email.")]),
  phone: z.string().max(50),
  isPrimary: z.boolean(),
})
type ContactValues = z.infer<typeof contactSchema>

const TEXT_FIELDS = [
  { name: "name", label: "Name", type: "text" },
  { name: "title", label: "Title", type: "text" },
  { name: "email", label: "Email", type: "email" },
  { name: "phone", label: "Phone", type: "tel" },
] as const

/** Add a Contact to an Account, or edit one (`contact`). */
export function ContactDialog({
  open,
  onOpenChange,
  accountId,
  contact,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string
  contact?: Contact | null
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const form = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: "",
      title: "",
      email: "",
      phone: "",
      isPrimary: false,
    },
  })
  useEffect(() => {
    if (open) {
      form.reset({
        name: contact?.name ?? "",
        title: contact?.title ?? "",
        email: contact?.email ?? "",
        phone: contact?.phone ?? "",
        isPrimary: contact?.isPrimary ?? false,
      })
    }
  }, [open, contact, form])

  const onSuccess = async () => {
    toast.success(contact ? "Contact saved." : "Contact added.")
    await queryClient.invalidateQueries(trpc.account.pathFilter())
    onOpenChange(false)
  }
  const onError = (e: unknown) => toast.error(errorMessage(e))
  const create = useMutation(
    trpc.contact.create.mutationOptions({ onSuccess, onError })
  )
  const update = useMutation(
    trpc.contact.update.mutationOptions({ onSuccess, onError })
  )
  const setPrimary = useMutation(trpc.contact.setPrimary.mutationOptions())
  const pending = create.isPending || update.isPending || setPrimary.isPending

  const onSubmit = form.handleSubmit(async ({ isPrimary, ...values }) => {
    if (!contact) {
      // Unticked → let the API decide (the first Contact becomes primary).
      create.mutate({ accountId, ...values, ...(isPrimary && { isPrimary }) })
      return
    }
    if (isPrimary && !contact.isPrimary) {
      try {
        await setPrimary.mutateAsync({ id: contact.id })
      } catch (e) {
        onError(e)
        return
      }
    }
    update.mutate({ id: contact.id, ...values })
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? "Edit Contact" : "Add Contact"}</DialogTitle>
        </DialogHeader>
        <form id="contact-form" onSubmit={onSubmit}>
          <FieldGroup>
            {TEXT_FIELDS.map(({ name, label, type }) => (
              <Controller
                key={name}
                name={name}
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={`contact-${name}`}>{label}</FieldLabel>
                    <Input
                      {...field}
                      id={`contact-${name}`}
                      type={type}
                      aria-invalid={fieldState.invalid}
                      autoComplete="off"
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
            ))}
            {!contact?.isPrimary && (
              <Controller
                name="isPrimary"
                control={form.control}
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <Checkbox
                      id="contact-isPrimary"
                      checked={field.value}
                      onCheckedChange={(c) => field.onChange(c === true)}
                    />
                    <FieldLabel htmlFor="contact-isPrimary">
                      Primary Contact for this Account
                    </FieldLabel>
                  </Field>
                )}
              />
            )}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" form="contact-form" disabled={pending}>
            {pending ? "Saving…" : contact ? "Save" : "Add Contact"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
