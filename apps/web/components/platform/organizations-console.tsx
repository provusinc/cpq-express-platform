"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { Building2Icon, MailIcon } from "lucide-react"

import type { RouterOutputs } from "@workspace/api"
import { Badge } from "@workspace/ui/components/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { PageHeader } from "@/components/shell/page-header"
import { formatDate } from "@/lib/format"
import { surfaceOrigin } from "@/lib/hosts"
import { useTRPC } from "@/trpc/react"

import { CreateOrganizationDialog } from "./create-organization-dialog"
import { InviteAdminDialog } from "./invite-admin-dialog"

type PlatformOrganization =
  RouterOutputs["platform"]["listOrganizations"][number]

/** The platform console's home: every Organization, and provisioning. */
export function OrganizationsConsole({
  appUrl,
  rootDomain,
}: {
  appUrl: string
  rootDomain: string
}) {
  const trpc = useTRPC()
  const { data: organizations } = useSuspenseQuery(
    trpc.platform.listOrganizations.queryOptions()
  )
  const originOf = (slug: string) =>
    surfaceOrigin(appUrl, rootDomain, { kind: "organization", slug })

  return (
    <>
      <PageHeader
        title="Organizations"
        description="Provision Organizations and invite their first Admins. Slugs can't be changed later."
      >
        <CreateOrganizationDialog originOf={originOf} rootDomain={rootDomain} />
      </PageHeader>
      {organizations.length === 0 ? (
        <Empty className="border bg-background">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2Icon />
            </EmptyMedia>
            <EmptyTitle>No Organizations yet</EmptyTitle>
            <EmptyDescription>
              Create the first one and invite its Admin.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead>Pending Invitations</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-0">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((organization) => (
                <OrganizationRow
                  key={organization.id}
                  organization={organization}
                  origin={originOf(organization.slug)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}

function OrganizationRow({
  organization,
  origin,
}: {
  organization: PlatformOrganization
  origin: string
}) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium">{organization.name}</span>
          <span className="text-xs text-muted-foreground">
            {new URL(origin).host}
          </span>
        </div>
      </TableCell>
      <TableCell>{organization.currencyCode}</TableCell>
      <TableCell className="text-right tabular-nums">
        {organization.memberCount}
      </TableCell>
      <TableCell>
        {organization.invitations.length === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {organization.invitations.map((invitation) => (
              <li
                key={invitation.email}
                className="flex items-center gap-2 text-xs"
              >
                <MailIcon className="size-3 text-muted-foreground" />
                <span className="truncate">{invitation.email}</span>
                {invitation.status === "expired" && (
                  <Badge variant="destructive">Expired</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {formatDate(organization.createdAt)}
      </TableCell>
      <TableCell>
        <InviteAdminDialog organization={organization} />
      </TableCell>
    </TableRow>
  )
}
