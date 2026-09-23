"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { UserPlusIcon } from "lucide-react"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { ROLE_LABELS, ROLES } from "@workspace/domain/enums"
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

import { errorMessage, fieldErrors } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

import { ROLE_DESCRIPTIONS, RoleSelect } from "./role-select"
import { useMembersMutationCallbacks } from "./use-members-mutation"

const formSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email address.")),
  role: z.enum(ROLES),
})
type FormValues = z.infer<typeof formSchema>

const DEFAULTS: FormValues = { email: "", role: "member" }

/** Invite someone to this Organization with a Role. */
export function InviteMemberDialog() {
  const [open, setOpen] = useState(false)
  const trpc = useTRPC()
  const { refresh } = useMembersMutationCallbacks()
  const create = useMutation(trpc.invitation.create.mutationOptions())
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: DEFAULTS,
  })

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) form.reset(DEFAULTS)
  }

  async function onSubmit(values: FormValues) {
    try {
      const invitation = await create.mutateAsync(values)
      await refresh()
      toast.success("Invitation sent", {
        description: `${invitation.email} can join as ${ROLE_LABELS[invitation.role]} for the next 7 days.`,
      })
      onOpenChange(false)
    } catch (error) {
      const fields = fieldErrors(error)
      if (fields.email) form.setError("email", { message: fields.email })
      else form.setError("root", { message: errorMessage(error) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button />}>
        <UserPlusIcon />
        Invite people
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <DialogHeader>
            <DialogTitle>Invite to the Organization</DialogTitle>
            <DialogDescription>
              We&apos;ll email a link that works once, for 7 days. They sign in
              with this address to accept.
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
              name="email"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="invite-email">Email</FieldLabel>
                  <Input
                    {...field}
                    id="invite-email"
                    type="email"
                    placeholder="colleague@company.com"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              name="role"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="invite-role">Role</FieldLabel>
                  <RoleSelect
                    id="invite-role"
                    className="w-40"
                    value={field.value}
                    onChange={field.onChange}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    {ROLE_DESCRIPTIONS[field.value]} The Approver right can be
                    granted after they join.
                  </FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Sending…" : "Send Invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
