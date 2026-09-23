import { ArrowRightIcon, Building2Icon, ShieldIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { SignOutButton } from "@/components/auth/sign-out-button"

export interface PickerOrganization {
  slug: string
  name: string
  role: "admin" | "manager" | "member"
  url: string
}

const ROLE_LABELS = { admin: "Admin", manager: "Manager", member: "Member" }

/**
 * The Organization picker on `app.`: every Organization the User holds a
 * Membership in, plus the platform console for Platform Admins.
 */
export function OrganizationPicker({
  email,
  organizations,
  adminConsoleUrl,
}: {
  email: string
  organizations: PickerOrganization[]
  /** Set for Platform Admins only. */
  adminConsoleUrl?: string
}) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">Choose an Organization</CardTitle>
        <CardDescription>Signed in as {email}.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {organizations.length === 0 && !adminConsoleUrl ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Building2Icon />
              </EmptyMedia>
              <EmptyTitle>You&apos;re not in any Organization yet</EmptyTitle>
              <EmptyDescription>
                You join an Organization by accepting an Invitation from one of
                its Admins. Check your email, or ask them to invite {email}.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {organizations.map((organization) => (
              <li key={organization.slug}>
                <PickerLink
                  href={organization.url}
                  title={organization.name}
                  subtitle={`${organization.slug} · ${ROLE_LABELS[organization.role]}`}
                  icon={<Building2Icon />}
                />
              </li>
            ))}
            {adminConsoleUrl && (
              <li>
                <PickerLink
                  href={adminConsoleUrl}
                  title="Platform console"
                  subtitle="Provision and operate Organizations"
                  icon={<ShieldIcon />}
                />
              </li>
            )}
          </ul>
        )}
        <div className="flex justify-end">
          <SignOutButton />
        </div>
      </CardContent>
    </Card>
  )
}

function PickerLink({
  href,
  title,
  subtitle,
  icon,
}: {
  href: string
  title: string
  subtitle: string
  icon: React.ReactNode
}) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 p-3 text-sm transition-colors hover:bg-muted/60 [&_svg]:size-4"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      </span>
      <ArrowRightIcon className="text-muted-foreground" />
    </a>
  )
}
