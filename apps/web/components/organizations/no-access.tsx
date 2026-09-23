import { LockIcon } from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { BrandLockup } from "@/components/brand/brand"

/**
 * Shown on an Organization subdomain to a signed-in User without a
 * Membership there. Deliberately identical whether or not the Organization
 * exists, so it reveals nothing.
 */
export function NoAccess({
  email,
  pickerUrl,
  title = "You don't have access to this Organization",
  reason = "which has no Membership here. Ask one of its Admins to invite you, or go to an Organization you belong to.",
}: {
  email: string
  pickerUrl: string
  title?: string
  /** Continues "You're signed in as {email}, …". */
  reason?: string
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-canvas p-6">
      <BrandLockup />
      <Empty className="max-w-md flex-none border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LockIcon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>
            You&apos;re signed in as {email}, {reason}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <a href={pickerUrl} className={buttonVariants()}>
            Choose an Organization
          </a>
        </EmptyContent>
      </Empty>
    </main>
  )
}

/** Inside the shell: a page the Member's Role doesn't allow (e.g. Settings). */
export function AdminsOnly() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LockIcon />
        </EmptyMedia>
        <EmptyTitle>Only Admins can open this page</EmptyTitle>
        <EmptyDescription>
          Ask an Admin of this Organization if you need something changed here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
