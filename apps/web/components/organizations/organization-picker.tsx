import { ArrowRightIcon, Building2Icon, ShieldIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import { SignOutButton } from "@/components/auth/sign-out-button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/shell/empty"

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
          <ItemGroup className="gap-0 divide-y rounded-lg border">
            {organizations.map((organization) => (
              <PickerLink
                key={organization.slug}
                href={organization.url}
                title={organization.name}
                subtitle={`${organization.slug} · ${ROLE_LABELS[organization.role]}`}
                icon={<Building2Icon />}
              />
            ))}
            {adminConsoleUrl && (
              <PickerLink
                href={adminConsoleUrl}
                title="Platform console"
                subtitle="Provision and operate Organizations"
                icon={<ShieldIcon />}
              />
            )}
          </ItemGroup>
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
    <Item
      role="listitem"
      render={<a href={href} />}
      className="gap-3 rounded-none p-3 first:rounded-t-lg last:rounded-b-lg hover:bg-muted/60"
    >
      <ItemMedia variant="icon" className="size-8 rounded-md bg-muted">
        {icon}
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0">
        <ItemTitle className="w-full truncate">{title}</ItemTitle>
        <ItemDescription className="truncate text-xs">
          {subtitle}
        </ItemDescription>
      </ItemContent>
      <ArrowRightIcon className="size-4 text-muted-foreground" />
    </Item>
  )
}
