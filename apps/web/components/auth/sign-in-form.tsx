"use client"

import { useState } from "react"
import { CircleAlertIcon } from "lucide-react"

import { signIn } from "@workspace/auth/react"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"

/** Auth.js error codes (`?error=`) → what the person should read. */
const ERROR_MESSAGES: Record<string, string> = {
  Verification:
    "That sign-in link has expired or was already used. Request a new one.",
  EmailSignin: "We couldn't send the sign-in email. Try again in a moment.",
  OAuthAccountNotLinked:
    "This email already signs in another way. Use the email link instead.",
  AccessDenied: "Sign-in was denied.",
}
const DEFAULT_ERROR = "Something went wrong signing you in. Try again."

export function SignInForm({
  callbackUrl,
  error,
  defaultEmail,
  oauthProviders,
}: {
  callbackUrl: string
  error?: string
  /** Pre-fills the email field (e.g. from an Invitation). */
  defaultEmail?: string
  oauthProviders: { id: string; name: string }[]
}) {
  const [pending, setPending] = useState<string | null>(null)

  async function onEmailSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const email = new FormData(event.currentTarget).get("email")
    if (typeof email !== "string" || !email) return
    setPending("nodemailer")
    // Redirects to /check-email once the link is sent.
    await signIn("nodemailer", { email, redirectTo: callbackUrl })
  }

  async function onOAuth(providerId: string) {
    setPending(providerId)
    await signIn(providerId, { redirectTo: callbackUrl })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-[-0.015em]">
          Sign in
        </CardTitle>
        <CardDescription>
          {oauthProviders.length > 0
            ? "Continue with your work account or an email link."
            : "We'll email you a link to sign in."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>
                {ERROR_MESSAGES[error] ?? DEFAULT_ERROR}
              </AlertDescription>
            </Alert>
          )}
          {oauthProviders.length > 0 && (
            <>
              <Field>
                {oauthProviders.map((provider) => (
                  <Button
                    key={provider.id}
                    type="button"
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => onOAuth(provider.id)}
                  >
                    Continue with {provider.name}
                  </Button>
                ))}
              </Field>
              <FieldSeparator>Or</FieldSeparator>
            </>
          )}
          <form onSubmit={onEmailSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  defaultValue={defaultEmail}
                  required
                />
              </Field>
              <Field>
                <Button type="submit" disabled={pending !== null}>
                  {pending === "nodemailer"
                    ? "Sending link…"
                    : "Email me a sign-in link"}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
