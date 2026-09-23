"use client"

import { useState } from "react"

import { signOut } from "@workspace/auth/react"
import { Button } from "@workspace/ui/components/button"

/**
 * Ends the session everywhere: Auth.js deletes the database session and
 * clears the `.<ROOT_DOMAIN>` cookie, so every subdomain is signed out.
 */
export function SignOutButton() {
  const [pending, setPending] = useState(false)
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        await signOut({ redirectTo: "/sign-in" })
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  )
}
