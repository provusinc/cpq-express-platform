"use client"

import { LogOutIcon, ShieldIcon } from "lucide-react"

import { signOut } from "@workspace/auth/react"
import { Button, buttonVariants } from "@workspace/ui/components/button"

import { ThemeToggle } from "@/components/theme-toggle"

/** Top bar of the Platform Admin console. */
export function PlatformHeader({
  email,
  organizationsUrl,
  signedOutUrl,
}: {
  email: string
  /** The Organization picker on `app.`. */
  organizationsUrl: string
  signedOutUrl: string
}) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <ShieldIcon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-sm font-semibold">Platform console</span>
          <span className="truncate text-xs text-muted-foreground">
            {email}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <a
            href={organizationsUrl}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            My Organizations
          </a>
          <Button
            variant="outline"
            size="sm"
            onClick={() => signOut({ redirectTo: signedOutUrl })}
          >
            <LogOutIcon />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  )
}
