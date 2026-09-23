"use client"

import { useMutation } from "@tanstack/react-query"
import { CircleAlertIcon, MailCheckIcon } from "lucide-react"
import { useState } from "react"

import { signOut } from "@workspace/auth/react"
import { ROLE_LABELS } from "@workspace/domain/enums"
import type { Role } from "@workspace/domain/enums"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { formatDate } from "@/lib/format"
import { errorMessage } from "@/lib/trpc-errors"
import { useTRPC } from "@/trpc/react"

/**
 * A pending Invitation for the signed-in User. Accepting creates their
 * Membership and takes them to the Organization. The Invitation belongs to
 * one email address: signed in as anyone else, they're asked to switch.
 */
export function AcceptInvitation({
  token,
  invitation,
  signedInAs,
  organizationUrl,
  switchAccountUrl,
}: {
  token: string
  invitation: {
    email: string
    role: Role
    expiresAt: Date
    organizationName: string
  }
  signedInAs: string
  organizationUrl: string
  /** Sign-in page (invited email pre-filled) that returns here. */
  switchAccountUrl: string
}) {
  const trpc = useTRPC()
  const accept = useMutation(trpc.invitation.accept.mutationOptions())
  const [leaving, setLeaving] = useState(false)
  const emailMatches = signedInAs.toLowerCase() === invitation.email
  const role = ROLE_LABELS[invitation.role]

  async function onAccept() {
    try {
      await accept.mutateAsync({ token })
      setLeaving(true)
      window.location.assign(organizationUrl)
    } catch {
      // Shown from `accept.error` below.
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-accent">
          <MailCheckIcon className="size-5 text-primary" />
        </div>
        <CardTitle className="text-2xl font-semibold tracking-[-0.015em]">
          Join {invitation.organizationName}
        </CardTitle>
        <CardDescription>
          You&apos;re invited to join {invitation.organizationName} on CPQ
          Express as {/^[AEIOU]/.test(role) ? "an" : "a"}{" "}
          <strong className="text-foreground">{role}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {emailMatches ? (
          <p className="text-muted-foreground">
            Signed in as {signedInAs}. The Invitation expires on{" "}
            {formatDate(invitation.expiresAt)}.
          </p>
        ) : (
          <Alert>
            <CircleAlertIcon />
            <AlertDescription>
              This Invitation was sent to <strong>{invitation.email}</strong>,
              but you&apos;re signed in as <strong>{signedInAs}</strong>. Sign
              in with {invitation.email} to accept it.
            </AlertDescription>
          </Alert>
        )}
        {accept.error && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertDescription>{errorMessage(accept.error)}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        {emailMatches ? (
          <Button
            className="w-full"
            onClick={onAccept}
            disabled={accept.isPending || leaving}
          >
            {accept.isPending || leaving ? "Joining…" : "Accept Invitation"}
          </Button>
        ) : (
          <Button
            className="w-full"
            onClick={() => signOut({ redirectTo: switchAccountUrl })}
          >
            Sign in as {invitation.email}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
