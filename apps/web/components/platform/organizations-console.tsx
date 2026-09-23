"use client"

import { useSuspenseQuery } from "@tanstack/react-query"
import { Building2Icon, MailIcon } from "lucide-react"
import { createContext, useContext } from "react"

import type { RouterOutputs } from "@workspace/api"
import { Badge } from "@workspace/ui/components/badge"
import type { DataTableColumns } from "@workspace/ui/components/niko-table/types"

import {
  ColumnTitle,
  ListTable,
  LocalTableRoot,
  SortableColumnTitle,
} from "@/components/shell/data-table"
import { PageHeader } from "@/components/shell/page-header"
import { formatDate } from "@/lib/format"
import { surfaceOrigin } from "@/lib/hosts"
import { useTRPC } from "@/trpc/react"

import { CreateOrganizationDialog } from "./create-organization-dialog"
import { InviteAdminDialog } from "./invite-admin-dialog"

type PlatformOrganization =
  RouterOutputs["platform"]["listOrganizations"][number]

type OrganizationCell = { row: { original: PlatformOrganization } }

/** How the Organization cell shows its subdomain; provided by the console. */
const OriginContext = createContext<(slug: string) => string>(() => "")

function HostCell({ row }: OrganizationCell) {
  const originOf = useContext(OriginContext)
  return (
    <span className="text-muted-foreground">
      {new URL(originOf(row.original.slug)).host}
    </span>
  )
}

function InvitationsCell({ row }: OrganizationCell) {
  const { invitations } = row.original
  if (invitations.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <ul className="flex flex-col gap-1">
      {invitations.map((invitation) => (
        <li key={invitation.email} className="flex items-center gap-2 text-xs">
          <MailIcon className="size-3 text-muted-foreground" />
          <span className="truncate">{invitation.email}</span>
          {invitation.status === "expired" && (
            <Badge variant="destructive">Expired</Badge>
          )}
        </li>
      ))}
    </ul>
  )
}

const columns: DataTableColumns<PlatformOrganization> = [
  {
    id: "name",
    accessorKey: "name",
    header: SortableColumnTitle,
    meta: { label: "Organization" },
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    id: "slug",
    accessorKey: "slug",
    header: SortableColumnTitle,
    meta: { label: "Subdomain" },
    cell: HostCell,
  },
  {
    id: "currencyCode",
    accessorKey: "currencyCode",
    header: SortableColumnTitle,
    meta: { label: "Currency" },
  },
  {
    id: "memberCount",
    accessorKey: "memberCount",
    header: SortableColumnTitle,
    meta: { label: "Members", align: "end" },
    cell: ({ row }) => (
      <div className="text-right tabular-nums">{row.original.memberCount}</div>
    ),
  },
  {
    id: "invitations",
    header: ColumnTitle,
    meta: { label: "Pending Invitations" },
    cell: InvitationsCell,
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: SortableColumnTitle,
    meta: { label: "Created" },
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
  {
    id: "actions",
    enableSorting: false,
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <InviteAdminDialog organization={row.original} />,
  },
]

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
      <OriginContext value={originOf}>
        <LocalTableRoot columns={columns} data={organizations} sortable>
          <ListTable
            empty={{
              icon: <Building2Icon />,
              title: "No Organizations yet",
              description: "Create the first one and invite its Admin.",
            }}
          />
        </LocalTableRoot>
      </OriginContext>
    </>
  )
}
