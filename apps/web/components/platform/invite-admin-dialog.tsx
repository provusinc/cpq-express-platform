"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { UserPlusIcon } from "lucide-react"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
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

const formSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email address.")),
})
type FormValues = z.infer<typeof formSchema>

/** Invites an Admin to one Organization (normally its first). */
export function InviteAdminDialog({
  organization,
}: {
  organization: { id: string; name: string }
}) {
  const [open, setOpen] = useState(false)
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const invite = useMutation(trpc.platform.inviteAdmin.mutationOptions())
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  })

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) form.reset({ email: "" })
  }

  async function onSubmit({ email }: FormValues) {
    try {
      const invitation = await invite.mutateAsync({
        organizationId: organization.id,
        email,
      })
      await queryClient.invalidateQueries({
        queryKey: trpc.platform.listOrganizations.queryKey(),
      })
      toast.success("Invitation sent", {
        description: `${invitation.email} can now join ${organization.name} as Admin.`,
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
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <UserPlusIcon />
        Invite Admin
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <DialogHeader>
            <DialogTitle>Invite an Admin to {organization.name}</DialogTitle>
            <DialogDescription>
              They&apos;ll get an email with a link that works once, for 7 days.
              Any earlier Invitation to the same address stops working.
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
                  <FieldLabel htmlFor={`invite-admin-${organization.id}`}>
                    Email
                  </FieldLabel>
                  <Input
                    {...field}
                    id={`invite-admin-${organization.id}`}
                    type="email"
                    placeholder="admin@company.com"
                    autoComplete="off"
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldDescription>
                    They must sign in with this address to accept.
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
